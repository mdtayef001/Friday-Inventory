from rest_framework import serializers

from apps.api import IdField

from .models import Payment, PaymentAccounts
from .services import MANUAL_METHODS, OWNER_METHODS


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
            "channel", "months", "reference", "sent_from", "note", "reviewed_at",
        ]
        read_only_fields = fields

    def get_payer(self, payment):
        return {"name": payment.payer_name, "email": payment.payer_email, "phone": payment.payer_phone}


class PaymentAccountsSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentAccounts
        fields = ["bkash", "nagad", "rocket", "bank", "contact"]


class ManualPaymentSerializer(serializers.Serializer):
    """What the owner fills in after sending money by hand."""

    method = serializers.ChoiceField(choices=OWNER_METHODS)
    months = serializers.ChoiceField(choices=[1, 3, 6, 12])
    reference = serializers.CharField(max_length=100, trim_whitespace=True)
    sent_from = serializers.CharField(max_length=100, trim_whitespace=True, allow_blank=True, required=False, default="")


class GrantSerializer(serializers.Serializer):
    """The super admin gives a business months directly."""

    months = serializers.IntegerField(min_value=1, max_value=24)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    method = serializers.ChoiceField(choices=list(MANUAL_METHODS))
    reference = serializers.CharField(max_length=100, allow_blank=True, required=False, default="")
    note = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")
