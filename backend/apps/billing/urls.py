from django.urls import path

from . import views

urlpatterns = [
    path("billing/config/", views.BillingConfigView.as_view()),
    path("billing/payments/", views.PaymentListView.as_view()),
    path("billing/payments/<int:pk>/", views.PaymentDetailView.as_view()),
    path("billing/checkout/", views.CheckoutView.as_view()),
    path("billing/manual/", views.ManualPaymentView.as_view()),
    path("billing/sslcommerz/<str:result>/", views.GatewayResultView.as_view()),
    path("billing/test-gateway/<str:tran_id>/", views.TestGatewayPaymentView.as_view()),
    path("platform/payments/", views.PlatformPaymentListView.as_view()),
    path("platform/payments/<int:pk>/<str:decision>/", views.PlatformPaymentReviewView.as_view()),
    path("platform/payment-accounts/", views.PlatformPaymentAccountsView.as_view()),
]
