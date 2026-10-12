import re

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


class CheckoutSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)

    def validate_phone(self, value):
        value = re.sub(r"[\s-]", "", value.strip())
        if not re.fullmatch(r"(\+?880|0)1[3-9]\d{8}", value):
            raise serializers.ValidationError("Enter a valid Bangladeshi mobile number, e.g. 01712345678")
        return value
