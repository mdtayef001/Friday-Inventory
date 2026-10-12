from django.db import migrations


def add_switch(apps_, schema_editor):
    """Existing businesses get the new "Client tracking links" switch, turned on."""
    Business = apps_.get_model("accounts", "Business")
    for business in Business.objects.all():
        modules = business.settings.setdefault("modules", {})
        if "trackingLinks" not in modules:
            modules["trackingLinks"] = True
            business.save(update_fields=["settings"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_initial")]

    operations = [migrations.RunPython(add_switch, migrations.RunPython.noop)]
