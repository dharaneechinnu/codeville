from __future__ import annotations

import json
import queue
from pathlib import Path

from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.response import Response
from rest_framework.views import APIView

from . import state
from .claude_hooks import from_claude_hook
from .events import parse_new_event
from .git import NotARepo, git_status
from .hub import hub
from .models import Project
from .runner import run_command, stop_run
from . import agent, connector, doctor, gitops, projects
from .serializers import (
    AgentSerializer, CloneSerializer, CommitSerializer, FileSerializer, NewProjectSerializer, FolderSerializer, PushSerializer, RunSerializer, StageSerializer,
)
from .analyzer import analyze_project
from .tools import ToolError, call_tool, list_tools


class HealthView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def get(self, request):
        return Response({"ok": True, "version": "0.1.0", "events": hub.size})


class EventsView(APIView):
    def get(self, request):
        try:
            n = int(request.query_params.get("n", 200))
        except ValueError:
            n = 200
        return Response(hub.recent(max(1, min(1000, n))))

    def post(self, request):
        items = request.data if isinstance(request.data, list) else [request.data]
        accepted = 0
        for item in items:
            event = parse_new_event(item)
            if event:
                hub.push(event)
                accepted += 1
        body = {"accepted": accepted, "rejected": len(items) - accepted}
        return Response(body, status=status.HTTP_202_ACCEPTED if accepted else status.HTTP_400_BAD_REQUEST)


class HookClaudeView(APIView):
    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        events = from_claude_hook(data)
        if data.get("hook_event_name") == "SessionStart" and data.get("cwd"):
            state.set_root(data["cwd"])
        hub.push_many(events)
        return Response({"accepted": len(events)}, status=status.HTTP_202_ACCEPTED)


class _AnyAccept(BaseContentNegotiation):
    """An event stream asks for text/event-stream, which the JSON renderer does not offer. Serve it anyway."""

    def select_parser(self, request, parsers):
        return parsers[0]

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


class StreamView(APIView):
    content_negotiation_class = _AnyAccept

    def get(self, request):
        q = hub.subscribe()
        backlog = hub.recent(100)
        seen = {e["id"] for e in backlog}

        def gen():
            try:
                yield ": connected\n\n"
                for e in backlog:
                    yield f"data: {json.dumps(e)}\n\n"
                while True:
                    try:
                        kind, payload = q.get(timeout=15)
                    except queue.Empty:
                        yield ": ping\n\n"
                        continue
                    if kind == "message":
                        if payload["id"] in seen:
                            continue
                        yield f"data: {json.dumps(payload)}\n\n"
                    else:
                        yield f"event: output\ndata: {json.dumps(payload)}\n\n"
            finally:
                hub.unsubscribe(q)

        response = StreamingHttpResponse(gen(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


class AnalyzeView(APIView):
    def post(self, request):
        s = FolderSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        analysis = analyze_project(s.validated_data["path"], hub.push)
        state.set_root(analysis["root"])
        Project.objects.update_or_create(root=analysis["root"], defaults={"name": analysis["name"], "kind": analysis["kind"]})
        return Response(analysis)


class RunView(APIView):
    def post(self, request):
        s = RunSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        cwd = s.validated_data["cwd"]
        root = s.validated_data.get("root") or cwd
        state.set_root(root)
        handle = run_command(
            s.validated_data["command"], cwd, hub,
            on_output=lambda line, stream, run_id: hub.output({"runId": run_id, "line": line, "stream": stream}),
            root=root,
        )
        return Response({"runId": handle.run_id}, status=status.HTTP_202_ACCEPTED)


class GitView(APIView):
    def post(self, request):
        s = FolderSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            result = git_status(s.validated_data["path"])
        except NotARepo as err:
            return Response({"error": str(err)}, status=status.HTTP_400_BAD_REQUEST)
        hub.push({"type": "git.status", "source": "git", **result})
        return Response(result)


class ToolsView(APIView):
    def get(self, request):
        return Response({"tools": list_tools()})


class ToolCallView(APIView):
    def post(self, request, name: str):
        args = request.data if request.data else {}
        try:
            return Response(call_tool(name, args, hub))
        except ToolError as err:
            return Response({"error": str(err)}, status=status.HTTP_400_BAD_REQUEST)


MAX_FILE_BYTES = 300 * 1024


def _problem_response(p: dict) -> Response:
    return Response({"error": p["what"], "problem": p}, status=status.HTTP_400_BAD_REQUEST)


class FileView(APIView):
    """Shows one file of the open project. It never reads outside that folder."""

    def post(self, request):
        s = FileSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        root = Path(s.validated_data["path"]).resolve()
        target = (root / s.validated_data["file"]).resolve()
        if target != root and root not in target.parents:
            return Response({"error": "That file is outside the project folder"}, status=status.HTTP_400_BAD_REQUEST)
        if not target.is_file():
            return Response({"error": f"That file does not exist: {s.validated_data['file']}"}, status=status.HTTP_400_BAD_REQUEST)
        size = target.stat().st_size
        data = target.read_bytes()[:MAX_FILE_BYTES]
        if b"\x00" in data[:4096]:
            return Response({"error": "That file is not text"}, status=status.HTTP_400_BAD_REQUEST)
        text = data.decode("utf-8", errors="replace")
        lines = len(text.splitlines()) or 1
        return Response({"file": target.relative_to(root).as_posix(), "text": text, "lines": lines, "truncated": size > MAX_FILE_BYTES})


class GitChangesView(APIView):
    def post(self, request):
        s = FolderSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            return Response(gitops.changes(s.validated_data["path"]))
        except gitops.GitProblem as err:
            return _problem_response(err.problem)


class GitStageView(APIView):
    def post(self, request):
        s = StageSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            gitops.stage(s.validated_data["path"], s.validated_data["files"], s.validated_data["stage"])
            return Response(gitops.changes(s.validated_data["path"]))
        except gitops.GitProblem as err:
            return _problem_response(err.problem)


class GitCommitView(APIView):
    def post(self, request):
        s = CommitSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            result = gitops.commit(s.validated_data["path"], s.validated_data["message"])
        except gitops.GitProblem as err:
            return _problem_response(err.problem)
        hub.push({"type": "git.commit", "source": "git", **result})
        return Response(result)


class GitPushView(APIView):
    def post(self, request):
        s = PushSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            result = gitops.push(s.validated_data["path"], s.validated_data["setUpstream"])
        except gitops.GitProblem as err:
            return _problem_response(err.problem)
        hub.push({"type": "git.push", "source": "git", **result})
        return Response(result)


class AgentSendView(APIView):
    def post(self, request):
        s = AgentSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        state.set_root(d["path"])
        try:
            run_id = agent.send_prompt(
                d["prompt"], d["path"], hub, model=d["model"] or None, accept_edits=d["acceptEdits"],
                on_output=lambda line, stream, rid: hub.output({"runId": rid, "line": line, "stream": stream}),
            )
        except agent.AgentProblem as err:
            return _problem_response(err.problem)
        return Response({"runId": run_id}, status=status.HTTP_202_ACCEPTED)


class StopView(APIView):
    def post(self, request):
        run_id = str((request.data or {}).get("runId", ""))
        stopped = agent.stop(run_id) or stop_run(run_id)
        return Response({"stopped": stopped})


def _open_project(path: str) -> Response:
    analysis = analyze_project(path, hub.push)
    state.set_root(analysis["root"])
    Project.objects.update_or_create(root=analysis["root"], defaults={"name": analysis["name"], "kind": analysis["kind"]})
    return Response(analysis, status=status.HTTP_201_CREATED)


class TemplatesView(APIView):
    def get(self, request):
        return Response({"templates": projects.list_templates()})


class NewProjectView(APIView):
    def post(self, request):
        s = NewProjectSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            path = projects.create(s.validated_data["parent"], s.validated_data["name"], s.validated_data["template"])
        except gitops.GitProblem as err:
            return _problem_response(err.problem)
        return _open_project(path)


class CloneView(APIView):
    def post(self, request):
        s = CloneSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            path = projects.clone(s.validated_data["parent"], s.validated_data["url"])
        except gitops.GitProblem as err:
            return _problem_response(err.problem)
        return _open_project(path)


class DoctorView(APIView):
    def get(self, request):
        return Response({"checks": doctor.check()})


class AgentStatusView(APIView):
    def get(self, request):
        return Response(connector.status())


class AgentDisconnectView(APIView):
    def post(self, request):
        try:
            return Response(connector.disconnect())
        except gitops.GitProblem as err:
            return _problem_response(err.problem)


class AgentConnectView(APIView):
    def post(self, request):
        try:
            return Response(connector.connect())
        except gitops.GitProblem as err:
            return _problem_response(err.problem)
