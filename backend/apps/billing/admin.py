from django.contrib import admin

from .models import Payment


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["tran_id", "business", "amount", "status", "method", "created_at", "paid_at"]
    list_filter = ["status"]
    search_fields = ["tran_id", "invoice_no"]
