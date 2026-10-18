from django.contrib import admin

from .models import (
    Activity, Client, Location, Product, Purchase, PurchaseItem, Rental, Sale, Shipment, StockLevel, StockRequest, Supplier, SupplierReturn,
    Transfer,
)

admin.site.register([Location, Client, StockLevel, Shipment, Rental, Transfer, StockRequest, Supplier])


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ["name", "sku", "business", "price", "rentable"]
    search_fields = ["name", "sku", "barcode"]


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ["at", "business", "user", "action", "detail"]


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ["sold_at", "business", "channel", "product_name", "quantity", "unit_price", "discount", "refunded_at"]
    list_filter = ["channel"]


class PurchaseItemInline(admin.TabularInline):
    model = PurchaseItem
    extra = 0


@admin.register(Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = ["number", "purchased_at", "business", "supplier", "location", "reference"]
    inlines = [PurchaseItemInline]


@admin.register(SupplierReturn)
class SupplierReturnAdmin(admin.ModelAdmin):
    list_display = ["number", "created_at", "business", "supplier", "product_name", "quantity", "status"]
    list_filter = ["status"]
