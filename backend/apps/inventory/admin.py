from django.contrib import admin

from .models import Activity, Client, Location, Product, Rental, Sale, Shipment, StockLevel, StockRequest, Transfer

admin.site.register([Location, Client, StockLevel, Shipment, Rental, Transfer, StockRequest])


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
