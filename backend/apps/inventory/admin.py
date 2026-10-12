from django.contrib import admin

from .models import Activity, Client, Location, Product, Rental, Shipment, StockLevel, Transfer

admin.site.register([Location, Client, StockLevel, Shipment, Rental, Transfer])


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ["name", "sku", "business", "price", "rentable"]
    search_fields = ["name", "sku", "barcode"]


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ["at", "business", "user", "action", "detail"]
