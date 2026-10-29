from django.db import models


class Event(models.Model):
    """Every event is kept, so the history survives a restart and agents can read it later."""

    id = models.CharField(max_length=40, primary_key=True)
    ts = models.BigIntegerField(db_index=True)
    type = models.CharField(max_length=24, db_index=True)
    source = models.CharField(max_length=12)
    session_id = models.CharField(max_length=80, blank=True, default="", db_index=True)
    payload = models.JSONField()

    class Meta:
        ordering = ["ts"]

    def __str__(self) -> str:
        return f"{self.type} {self.id}"


class Project(models.Model):
    """A folder the user opened. The last one opened is what the agent tools work on by default."""

    root = models.CharField(max_length=1024, unique=True)
    name = models.CharField(max_length=200)
    kind = models.CharField(max_length=60, blank=True, default="")
    opened_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-opened_at"]

    def __str__(self) -> str:
        return self.name
