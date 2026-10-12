from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Business, User


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ["name", "industry", "status", "trial_ends_at", "paid_until", "suspended", "created_at"]
    list_filter = ["suspended"]
    search_fields = ["name"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["email"]
    list_display = ["email", "name", "role", "business", "is_active", "last_login"]
    list_filter = ["role", "is_active"]
    search_fields = ["email", "name"]
    filter_horizontal = ["locations"]
    fieldsets = [
        (None, {"fields": ["email", "password"]}),
        ("Profile", {"fields": ["name", "role", "business", "locations", "is_active"]}),
        ("Dates", {"fields": ["last_login", "date_joined"]}),
    ]
    add_fieldsets = [
        (None, {"classes": ["wide"], "fields": ["email", "name", "role", "business", "password1", "password2"]}),
    ]
