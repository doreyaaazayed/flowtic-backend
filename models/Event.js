const mongoose = require("mongoose");

// Aligns with EventManagementDB.Event collection definition
const eventSchema = new mongoose.Schema(
  {
    EventID: {
      type: Number,
      required: true,
      unique: true,
    },
    /** Platform venue — used for venue_only and full_setup */
    VenueID: {
      type: Number,
      required: false,
    },
    /**
     * What FlowTic provides: ticketing_only | equipment_only | venue_only | full_setup
     */
    hostingMode: {
      type: String,
      enum: ["ticketing_only", "equipment_only", "venue_only", "full_setup"],
      default: "full_setup",
    },
    /** Organizer's own venue when not using platform VenueID */
    externalVenue: {
      name: { type: String, trim: true },
      /** City / area — shown on public listings */
      location: { type: String, trim: true },
      /** Street / building — only after ticket purchase */
      address: { type: String, trim: true },
      capacity: { type: Number, min: 0 },
    },
    CategoryID: {
      type: Number,
      required: true,
    },
    Name: {
      type: String,
      required: true,
      trim: true,
    },
    Description: {
      type: String,
      trim: true,
    },
    StartDate: {
      type: Date,
      required: true,
    },
    EndDate: {
      type: Date,
      required: true,
    },
    Status: {
      type: String,
      required: true, // Active, Cancelled, Completed
      trim: true,
    },
    // Optional max capacity for the event
    capacity: { type: Number, min: 0 },
    // If true, event has a seat map; tickets are sold by specific seat (section/row/seat number) for F&B delivery
    isSeated: { type: Boolean, default: false },
    // Floor plan / seating diagram for seated events (URL or data URL); used for AI + interactive map
    seatMapFloorPlanUrl: { type: String, trim: true },
    /** Stage / pitch edge relative to seating schematic: top | bottom | left | right | center | none */
    seatMapStagePosition: {
      type: String,
      enum: ["top", "bottom", "left", "right", "center", "none"],
      default: "bottom",
    },
    // Optional image: URL or data URL (base64) for event photo
    imageUrl: { type: String, trim: true },
    // Organizer reference (not in original schema, but useful for app logic)
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Multi-gate time-slot entry (crowd management) configured for this event */
    entryGatingEnabled: { type: Boolean, default: false },
    /** Allow ushers to manually admit with logged reason when Face ID fails (organizer enables per event) */
    usherManualFallbackEnabled: { type: Boolean, default: false },
    /** Optional PIN ushers enter for manual admit (plain text; set only if fallback enabled) */
    usherGateOverridePin: { type: String, trim: true, default: "" },
    /** When set, general public can book from this time; higher tiers may book earlier */
    ticketSalesOpensAt: { type: Date },
    /** Setup choices from the static catalogue (display labels), e.g. "Center piece 1", "Stage 2" */
    selectedEquipment: {
      type: [String],
      default: undefined,
    },
    /** Optional headline act / mega star (organizer opt-in at create) */
    megaStar: {
      starId: { type: String, trim: true },
      durationId: { type: String, trim: true },
      starName: { type: String, trim: true },
      durationLabel: { type: String, trim: true },
      priceEgp: { type: Number, min: 0 },
      displayLabel: { type: String, trim: true },
    },
    /** Catalogue line ids + qty (qty does not change price) */
    equipmentSelection: [
      {
        id: { type: String, trim: true },
        quantity: { type: Number, min: 1, default: 1 },
      },
    ],
    /** Setup deposit after admin approval (equipment + mega star + platform fee) */
    setupDeposit: {
      equipmentSubtotalEgp: { type: Number, min: 0, default: 0 },
      megaStarEgp: { type: Number, min: 0, default: 0 },
      subtotalEgp: { type: Number, min: 0, default: 0 },
      platformFeePercent: { type: Number, min: 0, default: 10 },
      platformFeeEgp: { type: Number, min: 0, default: 0 },
      totalEgp: { type: Number, min: 0, default: 0 },
      paymentStatus: {
        type: String,
        enum: ["not_required", "awaiting_payment", "paid"],
        default: "not_required",
      },
      paidAt: { type: Date },
      paymentCardId: { type: mongoose.Schema.Types.ObjectId, ref: "UserPaymentCard" },
    },
    /** Bride/groom, honoree, or host names + custom invite line for private-category events */
    invitationDetails: {
      brideName: { type: String, trim: true },
      groomName: { type: String, trim: true },
      honoreeName: { type: String, trim: true },
      hostNames: { type: String, trim: true },
      customMessage: { type: String, trim: true },
    },
  },
  {
    timestamps: true,
    collection: "Event",
  }
);

eventSchema.index({ Status: 1, StartDate: 1 });
eventSchema.index({ organizer: 1 });
// Indexes tuned for the public listing query (filter on CategoryID/VenueID/Status, sort by StartDate)
eventSchema.index({ CategoryID: 1, Status: 1, StartDate: 1 });
eventSchema.index({ VenueID: 1, Status: 1, StartDate: 1 });
eventSchema.index({ Status: 1, CategoryID: 1, StartDate: 1 });
// Lightweight text-style index for case-insensitive name search
eventSchema.index({ Name: 1 }, { collation: { locale: "en", strength: 2 } });

module.exports = mongoose.model("Event", eventSchema);

