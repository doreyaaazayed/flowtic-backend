const Event = require("../models/Event");
const UserPaymentCard = require("../models/UserPaymentCard");
const eventOrganizerNotifications = require("../services/eventOrganizerNotifications");

function isOrganizer(event, userId) {
  if (!userId || !event?.organizer) return false;
  return String(event.organizer) === String(userId);
}

exports.getSetupDeposit = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin && !isOrganizer(event, userId)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    return res.json({
      _id: event._id,
      Name: event.Name,
      Status: event.Status,
      setupDeposit: event.setupDeposit || null,
      selectedEquipment: event.selectedEquipment || [],
      megaStar: event.megaStar || null,
    });
  } catch (err) {
    console.error("Get setup deposit error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.paySetupDeposit = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const userId = req.user?.id;
    if (!isOrganizer(event, userId)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (event.Status !== "AwaitingDeposit") {
      return res.status(400).json({
        message: "Event is not awaiting a setup deposit payment",
      });
    }

    const deposit = event.setupDeposit || {};
    if (deposit.paymentStatus !== "awaiting_payment") {
      return res.status(400).json({ message: "Deposit is not awaiting payment" });
    }

    if ((deposit.totalEgp || 0) <= 0) {
      return res.status(400).json({ message: "No deposit amount due" });
    }

    const { paymentMethod, paymentCardId } = req.body || {};
    const method = String(paymentMethod || "card").toLowerCase();

    if (method === "card" && paymentCardId) {
      const card = await UserPaymentCard.findOne({
        _id: paymentCardId,
        userId,
      });
      if (!card) {
        return res.status(400).json({ message: "Payment card not found" });
      }
      event.setupDeposit.paymentCardId = card._id;
    } else if (method !== "card") {
      return res.status(400).json({ message: "Only card payment is supported for setup deposits" });
    }

    event.setupDeposit.paymentStatus = "paid";
    event.setupDeposit.paidAt = new Date();
    event.Status = "Active";

    await event.save();

    eventOrganizerNotifications
      .notifyDepositPaid(event)
      .catch((err) => console.warn("Deposit paid notify:", err?.message || err));

    return res.json({
      message: "Deposit paid successfully. Your event is now live.",
      event: {
        _id: event._id,
        Status: event.Status,
        setupDeposit: event.setupDeposit,
      },
    });
  } catch (err) {
    console.error("Pay setup deposit error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
