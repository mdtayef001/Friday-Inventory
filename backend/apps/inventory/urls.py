from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("locations", views.LocationViewSet, basename="location")
router.register("products", views.ProductViewSet, basename="product")
router.register("stock", views.StockViewSet, basename="stock")
router.register("clients", views.ClientViewSet, basename="client")
router.register("shipments", views.ShipmentViewSet, basename="shipment")
router.register("rentals", views.RentalViewSet, basename="rental")
router.register("transfers", views.TransferViewSet, basename="transfer")
router.register("activity", views.ActivityViewSet, basename="activity")

urlpatterns = [
    path("track/<str:token>/", views.PublicTrackingView.as_view()),
    *router.urls,
]
