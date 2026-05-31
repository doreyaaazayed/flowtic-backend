const Review = require("../models/Review");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");

// List reviews for an event (public)
exports.listByEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const reviews = await Review.find({ eventId })
      .populate("userId", "Username Email")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(reviews);
  } catch (err) {
    console.error("List reviews error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Post a review for an event (must own a ticket for this event)
exports.create = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { eventId } = req.params;
    const { rating, comment } = req.body || {};
    if (rating == null || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "rating between 1 and 5 is required" });
    }
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    const hasTicket = await Ticket.findOne({
      EventID: event.EventID,
      OwnerUserId: userId,
    });
    if (!hasTicket) {
      return res.status(403).json({ message: "You must have a ticket for this event to review it" });
    }
    const existing = await Review.findOne({ userId, eventId });
    if (existing) {
      return res.status(409).json({ message: "You have already reviewed this event" });
    }
    const review = await Review.create({
      userId,
      eventId,
      rating: Number(rating),
      comment: comment || "",
    });
    return res.status(201).json(review);
  } catch (err) {
    console.error("Create review error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get one review by id (public)
exports.getById = async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId)
      .populate("userId", "Username Email")
      .lean();
    if (!review) return res.status(404).json({ message: "Review not found" });
    return res.json(review);
  } catch (err) {
    console.error("Get review error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update own review
exports.update = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const review = await Review.findById(req.params.reviewId);
    if (!review) return res.status(404).json({ message: "Review not found" });
    if (String(review.userId) !== String(userId)) {
      return res.status(403).json({ message: "You can only update your own review" });
    }
    const { rating, comment } = req.body || {};
    if (rating !== undefined) {
      if (rating < 1 || rating > 5) return res.status(400).json({ message: "rating must be 1–5" });
      review.rating = Number(rating);
    }
    if (comment !== undefined) review.comment = comment;
    await review.save();
    return res.json(review);
  } catch (err) {
    console.error("Update review error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete own review
exports.remove = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const review = await Review.findById(req.params.reviewId);
    if (!review) return res.status(404).json({ message: "Review not found" });
    if (String(review.userId) !== String(userId)) {
      return res.status(403).json({ message: "You can only delete your own review" });
    }
    await Review.findByIdAndDelete(req.params.reviewId);
    return res.status(204).send();
  } catch (err) {
    console.error("Delete review error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
