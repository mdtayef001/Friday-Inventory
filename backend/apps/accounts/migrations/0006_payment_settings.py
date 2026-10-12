from django.db import migrations, models
import django.db.models.deletion


def add_payments(apps_, schema_editor):
    """Existing businesses start with cash only."""
    Business = apps_.get_model("accounts", "Business")
    for business in Business.objects.all():
        if "payments" not in business.settings:
            business.settings["payments"] = {"mobile": False, "mobileNumber": "", "card": False, "online": False}
            business.save(update_fields=["settings"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0005_staff_rights")]

    operations = [
        migrations.RunPython(add_payments, migrations.RunPython.noop),
        migrations.CreateModel(
            name="MerchantAccount",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("store_id", models.CharField(max_length=100)),
                ("store_password", models.TextField()),
                ("sandbox", models.BooleanField(default=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("business", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="merchant", to="accounts.business")),
            ],
        ),
    ]
