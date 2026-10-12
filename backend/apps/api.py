"""Shared serializer pieces. The frontend's types use string ids, so every id
goes out as a string and is accepted as one."""

from rest_framework import serializers


class IdField(serializers.CharField):
    def __init__(self, **kwargs):
        kwargs.setdefault("read_only", True)
        super().__init__(**kwargs)

    def to_representation(self, value):
        return None if value is None else str(value)


class StrPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    def to_representation(self, value):
        return str(value.pk)

    def to_internal_value(self, data):
        try:
            data = int(data)
        except (TypeError, ValueError):
            self.fail("incorrect_type", data_type=type(data).__name__)
        return super().to_internal_value(data)


class TenantRelatedField(StrPrimaryKeyRelatedField):
    """Only accepts ids from the requesting user's own business."""

    def get_queryset(self):
        return super().get_queryset().filter(business=self.context["request"].user.business)


def tenant_field(model, **kwargs):
    return TenantRelatedField(queryset=model.objects.all(), **kwargs)
