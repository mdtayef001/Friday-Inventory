from django.db import migrations, models


def keep_renting(apps_, schema_editor):
    """Staff who could sell could also rent until now: they keep it, so nothing changes for them."""
    User = apps_.get_model("accounts", "User")
    User.objects.filter(can_sell=True).update(can_rent=True)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0008_manager_purchases_setting")]

    operations = [
        migrations.AddField(model_name="user", name="can_rent", field=models.BooleanField(default=False)),
        migrations.RunPython(keep_renting, migrations.RunPython.noop),
    ]
