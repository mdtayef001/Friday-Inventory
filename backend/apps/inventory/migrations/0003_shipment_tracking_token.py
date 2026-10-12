import secrets

from django.db import migrations, models

import apps.inventory.models


def fill_tokens(apps_, schema_editor):
    """Existing orders each get their own random token."""
    Shipment = apps_.get_model("inventory", "Shipment")
    for shipment in Shipment.objects.filter(tracking_token__isnull=True):
        shipment.tracking_token = secrets.token_urlsafe(16)
        shipment.save(update_fields=["tracking_token"])


class Migration(migrations.Migration):
    dependencies = [("inventory", "0002_location_creation_order")]

    operations = [
        migrations.AddField(
            model_name="shipment",
            name="tracking_token",
            field=models.CharField(max_length=32, null=True),
        ),
        migrations.RunPython(fill_tokens, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="shipment",
            name="tracking_token",
            field=models.CharField(default=apps.inventory.models.tracking_token, max_length=32, unique=True),
        ),
    ]
