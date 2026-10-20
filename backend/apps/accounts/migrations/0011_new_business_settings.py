from django.db import migrations

NEW = {"modules": {"purchases": True}, "permissions": {"managerReturns": False}}


def add_settings(apps_, schema_editor):
    """Existing businesses get the new settings: buying stays on, managers still ask for returns,
    no receipt note, and new products alert at 5 (what the product form always used)."""
    Business = apps_.get_model("accounts", "Business")
    for business in Business.objects.all():
        s = business.settings
        for group, values in NEW.items():
            for key, value in values.items():
                s.setdefault(group, {}).setdefault(key, value)
        s.setdefault("receiptNote", "")
        s.setdefault("lowStockAlert", 5)
        business.save(update_fields=["settings"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0010_business_cancel_and_deletion")]

    operations = [migrations.RunPython(add_settings, migrations.RunPython.noop)]
