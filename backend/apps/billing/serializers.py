import re

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
    """Every payment option, for the super admin to edit."""

    class Meta:
        model = PaymentAccounts
        exclude = ["id"]
        extra_kwargs = {"monthly_price": {"min_value": 1, "max_value": 1_000_000}, "trial_days": {"max_value": 90}}

    def validate_whatsapp(self, value):
        value = value.strip().lstrip("@")
        if value and not re.fullmatch(r"[A-Za-z0-9._]{2,40}", value):
            raise serializers.ValidationError("A WhatsApp username has letters, numbers, dots and underscores only.")
        return value


class PaymentOptionsSerializer(serializers.BaseSerializer):
    """What an owner sees: only the options that are on and filled in."""

    def to_representation(self, accounts):
        bank = None
        if accounts.bank_ready():
            bank = {
                "name": accounts.bank_name, "account_name": accounts.bank_account_name, "account_number": accounts.bank_account_number,
                "branch": accounts.bank_branch, "routing": accounts.bank_routing,
            }
        return {
            "wallets": [{"id": w, "label": MANUAL_METHODS[w], "number": n, "kind": k} for w, n, k in accounts.wallets()],
            "bank": bank,
            "whatsapp": accounts.whatsapp,
        }


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
