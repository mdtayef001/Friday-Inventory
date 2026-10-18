from django.db import migrations


def drop_online(apps_, schema_editor):
    """Online payments at the counter are gone: forget the switch."""
    Business = apps_.get_model("accounts", "Business")
    for business in Business.objects.all():
        payments = business.settings.get("payments")
        if isinstance(payments, dict) and "online" in payments:
            del payments["online"]
            business.save(update_fields=["settings"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0006_payment_settings")]

    operations = [
        migrations.RunPython(drop_online, migrations.RunPython.noop),
        migrations.DeleteModel(name="MerchantAccount"),
    ]
