from django.db import migrations, models


def settle_online_sales(apps_, schema_editor):
    """Online sales still waiting give their stock back; unpaid ones (waiting, failed,
    cancelled) never counted and are deleted. Paid ones keep counting, with the
    payment method left as not recorded."""
    Sale = apps_.get_model("inventory", "Sale")
    StockLevel = apps_.get_model("inventory", "StockLevel")
    for sale in Sale.objects.filter(payment_status="pending").exclude(product=None).exclude(location=None):
        row, _ = StockLevel.objects.get_or_create(
            business_id=sale.business_id, product_id=sale.product_id, location_id=sale.location_id
        )
        row.quantity += sale.quantity
        row.save(update_fields=["quantity"])
    Sale.objects.exclude(payment_status="paid").delete()
    Sale.objects.filter(payment_method="online").update(payment_method="")


class Migration(migrations.Migration):
    dependencies = [("inventory", "0012_checkout_with_several_items")]

    operations = [
        migrations.RunPython(settle_online_sales, migrations.RunPython.noop),
        migrations.RemoveField(model_name="sale", name="bank_tran_id"),
        migrations.RemoveField(model_name="sale", name="gateway_method"),
        migrations.RemoveField(model_name="sale", name="payment_status"),
        migrations.RemoveField(model_name="sale", name="refund_ref_id"),
        migrations.RemoveField(model_name="sale", name="refund_status"),
        migrations.RemoveField(model_name="sale", name="tran_id"),
        migrations.RemoveField(model_name="sale", name="val_id"),
        migrations.AlterField(
            model_name="sale",
            name="payment_method",
            field=models.CharField(blank=True, choices=[("cash", "Cash"), ("mobile", "Mobile banking"), ("card", "Card machine")], max_length=10),
        ),
    ]
