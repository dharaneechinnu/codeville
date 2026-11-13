from __future__ import annotations

from pathlib import Path

from rest_framework import serializers


class FolderSerializer(serializers.Serializer):
    path = serializers.CharField(error_messages={"required": "Send a folder path", "blank": "Send a folder path"})

    def validate_path(self, value: str) -> str:
        p = Path(value).expanduser().resolve()
        if not p.is_dir():
            raise serializers.ValidationError(f"That folder does not exist: {p}")
        return str(p)


class RunSerializer(serializers.Serializer):
    command = serializers.CharField(error_messages={"required": "Send a command to run", "blank": "Send a command to run"})
    cwd = serializers.CharField(error_messages={"required": "Send a folder to run it in", "blank": "Send a folder to run it in"})

    def validate_cwd(self, value: str) -> str:
        p = Path(value).expanduser().resolve()
        if not p.is_dir():
            raise serializers.ValidationError(f"That folder does not exist: {p}")
        return str(p)

    root = serializers.CharField(required=False, allow_blank=True)

    def validate_root(self, value: str) -> str:
        if not value:
            return value
        p = Path(value).expanduser().resolve()
        if not p.is_dir():
            raise serializers.ValidationError(f"That folder does not exist: {p}")
        return str(p)

    def validate_command(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Send a command to run")
        return value


class FileSerializer(FolderSerializer):
    file = serializers.CharField(error_messages={"required": "Send the file to open", "blank": "Send the file to open"})


class FileWriteSerializer(FileSerializer):
    content = serializers.CharField(allow_blank=True, trim_whitespace=False, max_length=2_000_000)
    base = serializers.CharField(allow_blank=True, trim_whitespace=False, max_length=2_000_000)


class AIEditSerializer(FileSerializer):
    instruction = serializers.CharField(max_length=4000, error_messages={"required": "Type what to change", "blank": "Type what to change"})
    provider = serializers.CharField(required=False, allow_blank=True, max_length=40)


class AISettingsSerializer(serializers.Serializer):
    provider = serializers.CharField(max_length=40)
    apiKey = serializers.CharField(required=False, allow_blank=True, max_length=400, trim_whitespace=True)
    model = serializers.CharField(required=False, allow_blank=True, max_length=200)
    baseUrl = serializers.CharField(required=False, allow_blank=True, max_length=400)
    clearKey = serializers.BooleanField(required=False, default=False)
    makeActive = serializers.BooleanField(required=False, default=False)


class StageSerializer(FolderSerializer):
    files = serializers.ListField(child=serializers.CharField(), allow_empty=False, error_messages={"required": "Pick the files", "empty": "Pick the files"})
    stage = serializers.BooleanField(default=True)


class CommitSerializer(FolderSerializer):
    message = serializers.CharField(allow_blank=True, default="")


class PushSerializer(FolderSerializer):
    setUpstream = serializers.BooleanField(default=False)


class AgentSerializer(FolderSerializer):
    prompt = serializers.CharField(error_messages={"required": "Write what you want done", "blank": "Write what you want done"})
    model = serializers.CharField(required=False, allow_blank=True, default="")
    acceptEdits = serializers.BooleanField(default=True)
    # Continue this Claude Code session; empty continues the project's latest one.
    sessionId = serializers.CharField(required=False, allow_blank=True, default="")
    # Start a new conversation instead of continuing.
    fresh = serializers.BooleanField(default=False)
    # Which AI engine gets the prompt; empty means Claude Code.
    engine = serializers.CharField(required=False, allow_blank=True, default="", max_length=40)


class EngineSerializer(serializers.Serializer):
    engine = serializers.CharField(max_length=40, error_messages={"required": "Pick an AI engine", "blank": "Pick an AI engine"})


class NewProjectSerializer(serializers.Serializer):
    parent = serializers.CharField(error_messages={"required": "Choose where to put the project", "blank": "Choose where to put the project"})
    name = serializers.CharField(error_messages={"required": "Give the project a name", "blank": "Give the project a name"})
    template = serializers.CharField(default="empty")


class CloneSerializer(serializers.Serializer):
    parent = serializers.CharField(error_messages={"required": "Choose where to put the project", "blank": "Choose where to put the project"})
    url = serializers.CharField(error_messages={"required": "Paste a repository link", "blank": "Paste a repository link"})


class TeamStartSerializer(FolderSerializer):
    request = serializers.CharField(max_length=8000, error_messages={"required": "Tell the team what to do", "blank": "Tell the team what to do"})


class TeamAnswerSerializer(serializers.Serializer):
    runId = serializers.CharField(max_length=80)
    gate = serializers.ChoiceField(choices=["pick", "design", "security"])
    roles = serializers.ListField(child=serializers.CharField(max_length=40), required=False, max_length=10)
    approve = serializers.BooleanField(required=False, default=False)
    proceed = serializers.BooleanField(required=False, default=False)
