from rest_framework import serializers

from apps.api import IdField

from .models import Payment


class PaymentSerializer(serializers.ModelSerializer):
    """Matches the Payment type in frontend/src/lib/types.ts."""

    id = IdField()
    business_id = IdField()
    business_name = serializers.CharField(source="business.name", read_only=True)
    payer = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id", "tran_id", "business_id", "business_name", "amount", "currency", "status", "method",
            "created_at", "paid_at", "period_start", "period_end", "invoice_no", "val_id", "bank_tran_id", "payer",
        ]
        read_only_fields = fields

    def get_payer(self, payment):
        return {"name": payment.payer_name, "email": payment.payer_email, "phone": payment.payer_phone}
