from django.db import migrations


def add_switch(apps_, schema_editor):
    """Existing businesses get the new "managers see profit" switch, turned off."""
    Business = apps_.get_model("accounts", "Business")
    for business in Business.objects.all():
        permissions = business.settings.setdefault("permissions", {})
        if "managerProfit" not in permissions:
            permissions["managerProfit"] = False
            business.save(update_fields=["settings"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_tracking_links_setting")]

    operations = [migrations.RunPython(add_switch, migrations.RunPython.noop)]
