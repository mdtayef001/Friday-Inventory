from django.urls import path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

router = DefaultRouter()
router.register("users", views.UserViewSet, basename="user")
router.register("platform/businesses", views.PlatformBusinessViewSet, basename="platform-business")

urlpatterns = [
    path("auth/login/", views.LoginView.as_view(), name="login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/logout/", views.LogoutView.as_view(), name="logout"),
    path("auth/me/", views.MeView.as_view(), name="me"),
    path("business/", views.BusinessSettingsView.as_view(), name="business"),
    path("business/export/", views.BusinessExportView.as_view(), name="business-export"),
    path("business/subscription/", views.SubscriptionView.as_view(), name="business-subscription"),
    path("business/deletion/", views.DeletionRequestView.as_view(), name="business-deletion"),
    path("cron/cleanup/", views.CronCleanupView.as_view(), name="cron-cleanup"),
    path("platform/users/<int:pk>/password/", views.PlatformUserPasswordView.as_view()),
    *router.urls,
]
