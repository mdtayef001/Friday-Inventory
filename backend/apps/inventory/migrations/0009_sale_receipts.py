import secrets

from django.db import migrations, models

import apps.inventory.models


def fill_receipts(apps, schema_editor):
    """Every existing sale gets its own link token; paid ones are numbered per
    business in the order they were sold."""
    Sale = apps.get_model("inventory", "Sale")
    numbers = {}
    for sale in Sale.objects.order_by("sold_at", "id").only("business_id", "payment_status"):
        fields = {"receipt_token": secrets.token_urlsafe(16)}
        if sale.payment_status == "paid":
            numbers[sale.business_id] = numbers.get(sale.business_id, 0) + 1
            fields["receipt_no"] = numbers[sale.business_id]
        Sale.objects.filter(pk=sale.pk).update(**fields)


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0008_rental_due_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='sale',
            name='receipt_no',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        # Added empty first: a default would give every existing sale the same token.
        migrations.AddField(
            model_name='sale',
            name='receipt_token',
            field=models.CharField(max_length=32, null=True),
        ),
        migrations.RunPython(fill_receipts, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='sale',
            name='receipt_token',
            field=models.CharField(default=apps.inventory.models.tracking_token, max_length=32, unique=True),
        ),
        migrations.AddConstraint(
            model_name='sale',
            constraint=models.UniqueConstraint(fields=('business', 'receipt_no'), name='unique_receipt_no_per_business'),
        ),
    ]
