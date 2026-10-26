from django.db import migrations


def add_switch(apps_, schema_editor):
    """Existing businesses get the new "staff can sell to walk-in customers" switch, turned on,
    so nothing changes until the owner turns it off."""
    Business = apps_.get_model("accounts", "Business")
    for business in Business.objects.all():
        permissions = business.settings.setdefault("permissions", {})
        if "staffWalkInSales" not in permissions:
            permissions["staffWalkInSales"] = True
            business.save(update_fields=["settings"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0011_new_business_settings")]

    operations = [migrations.RunPython(add_switch, migrations.RunPython.noop)]
