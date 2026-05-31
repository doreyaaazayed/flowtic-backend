const express = require("express");
const {
  listListings,
  getFeaturedListing,
  listPendingListings,
  listMyListings,
  getListingById,
  updateListing,
  removeListing,
  approveListing,
  rejectListing,
  eligibleTickets,
  createListing,
  createRequest,
  listPendingRequests,
  listPaymentPendingRequests,
  getRequestById,
  listMyRequests,
  getMyRequest,
  approveRequest,
  confirmPaymentAndTransfer,
  buyerConfirmPaymentAndTransfer,
  adminTicketTransferHistory,
  rejectRequest,
  removeRequest,
} = require("../controllers/resaleController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/listings", listListings);
router.get("/listings/featured", getFeaturedListing);
router.get("/listings/pending", requireAuth, requireRole("admin"), listPendingListings);
router.get("/my-listings", requireAuth, listMyListings);
router.get("/listings/:id", getListingById);
router.put("/listings/:id", requireAuth, updateListing);
router.patch("/listings/:id", requireAuth, updateListing);
router.delete("/listings/:id", requireAuth, removeListing);
router.post("/listings/:id/approve-listing", requireAuth, requireRole("admin"), approveListing);
router.post("/listings/:id/reject-listing", requireAuth, requireRole("admin"), rejectListing);
router.get("/eligible-tickets", requireAuth, eligibleTickets);
router.post("/list", requireAuth, createListing);
router.post("/request", requireAuth, createRequest);
router.get("/requests/pending", requireAuth, requireRole("admin"), listPendingRequests);
router.get("/requests/payment-pending", requireAuth, requireRole("admin"), listPaymentPendingRequests);
router.get("/my-requests", requireAuth, listMyRequests);
router.get("/requests/my/:requestId", requireAuth, getMyRequest);
router.get("/requests/:requestId", requireAuth, requireRole("admin"), getRequestById);
router.post("/requests/:requestId/approve", requireAuth, requireRole("admin"), approveRequest);
router.post("/requests/:requestId/confirm-payment", requireAuth, requireRole("admin"), confirmPaymentAndTransfer);
router.post("/requests/:requestId/complete-purchase", requireAuth, buyerConfirmPaymentAndTransfer);
router.get("/admin/tickets/:ticketId/transfer-history", requireAuth, requireRole("admin"), adminTicketTransferHistory);
router.post("/requests/:requestId/reject", requireAuth, requireRole("admin"), rejectRequest);
router.delete("/requests/:requestId", requireAuth, requireRole("admin"), removeRequest);

module.exports = router;
