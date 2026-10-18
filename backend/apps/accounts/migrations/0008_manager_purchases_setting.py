from django.db import migrations


def add_switch(apps_, schema_editor):
    """Existing businesses get the new "managers handle purchases" switch, turned off."""
    Business = apps_.get_model("accounts", "Business")
    for business in Business.objects.all():
        permissions = business.settings.setdefault("permissions", {})
        if "managerPurchases" not in permissions:
            permissions["managerPurchases"] = False
            business.save(update_fields=["settings"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0007_remove_online_payments")]

    operations = [migrations.RunPython(add_switch, migrations.RunPython.noop)]
