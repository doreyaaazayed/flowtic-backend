const User = require("../models/User");
const UserProfile = require("../models/UserProfile");
const Event = require("../models/Event");
const Booking = require("../models/Booking");
const BookingDetail = require("../models/BookingDetail");
const Ticket = require("../models/Ticket");
const ResaleRequest = require("../models/ResaleRequest");
const adminDashboard = require("../services/adminDashboardService");
const platformRevenue = require("../services/platformRevenueService");

// Admin: platform-wide stats
exports.getAdminStats = async (req, res) => {
  try {
    const [totalUsers, activeEvents, totalPlatformRevenue, pendingEvents, pendingListings, pendingRequests] = await Promise.all([
      User.countDocuments(),
      Event.countDocuments({ Status: { $in: ["Active", "Completed"] } }),
      platformRevenue.getTotalPlatformRevenue(),
      Event.countDocuments({ Status: "Pending" }),
      require("../models/ResaleListing").countDocuments({ status: "PendingApproval" }),
      ResaleRequest.countDocuments({ status: "PaymentPending" }),
    ]);
    return res.json({
      totalUsers,
      activeEvents,
      platformRevenue: totalPlatformRevenue,
      fraudCount: 0,
      pendingEvents,
      pendingListings,
      pendingRequests,
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: chart data – last 6 months (users, events, revenue)
exports.getAdminChart = async (req, res) => {
  try {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        month: d.toLocaleString("default", { month: "short" }),
        year: d.getFullYear(),
        start: d,
        end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
      });
    }
    const [monthlyRevenue, userEventCounts] = await Promise.all([
      platformRevenue.getMonthlyPlatformRevenue(months),
      Promise.all(
        months.map(async (m) => {
          const [users, events] = await Promise.all([
            User.countDocuments({ Created_At: { $gte: m.start, $lte: m.end } }),
            Event.countDocuments({ createdAt: { $gte: m.start, $lte: m.end } }),
          ]);
          return { month: m.month, users, events };
        }),
      ),
    ]);
    const chartData = months.map((m, i) => ({
      month: m.month,
      users: userEventCounts[i].users,
      events: userEventCounts[i].events,
      revenue: monthlyRevenue[i].revenue,
    }));
    return res.json(chartData);
  } catch (err) {
    console.error("Admin chart error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getAdminSecurity = async (req, res) => {
  try {
    const panel = await adminDashboard.getSecurityPanel();
    return res.json(panel);
  } catch (err) {
    console.error("Admin security panel error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getAdminActivity = async (req, res) => {
  try {
    const items = await adminDashboard.getRecentActivity();
    return res.json({ items });
  } catch (err) {
    console.error("Admin activity feed error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Organizer: my events count, revenue, tickets sold
exports.getOrganizerStats = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const myEvents = await Event.find({ organizer: userId }).select("EventID").lean();
    const myEventIds = myEvents.map((e) => e.EventID);
    if (myEventIds.length === 0) {
      return res.json({
        eventCount: 0,
        totalRevenue: 0,
        totalTicketsSold: 0,
        totalAttendees: 0,
      });
    }
    const [ticketStats, revenueResult] = await Promise.all([
      Ticket.aggregate([
        {
          $match: {
            EventID: { $in: myEventIds },
            OwnerUserId: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            totalTicketsSold: { $sum: 1 },
            attendees: { $addToSet: "$OwnerUserId" },
          },
        },
      ]),
      BookingDetail.aggregate([
        {
          $lookup: {
            from: "Ticket",
            localField: "TicketID",
            foreignField: "TicketID",
            as: "ticket",
          },
        },
        { $unwind: "$ticket" },
        { $match: { "ticket.EventID": { $in: myEventIds } } },
        { $group: { _id: null, total: { $sum: "$PriceAtBooking" } } },
      ]),
    ]);
    const stats = ticketStats[0];
    const totalRevenue = (revenueResult[0] && revenueResult[0].total) || 0;
    res.set("Cache-Control", "private, max-age=30");
    return res.json({
      eventCount: myEventIds.length,
      totalRevenue,
      totalTicketsSold: stats?.totalTicketsSold ?? 0,
      totalAttendees: stats?.attendees?.length ?? 0,
    });
  } catch (err) {
    console.error("Organizer stats error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Organizer: chart – sales (revenue) by month for my events (by booking date)
exports.getOrganizerChart = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const myEvents = await Event.find({ organizer: userId }).select("EventID").lean();
    const myEventIds = myEvents.map((e) => e.EventID);
    if (myEventIds.length === 0) return res.json([]);
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        month: d.toLocaleString("default", { month: "short" }),
        start: d,
        end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
      });
    }
    const chartData = await Promise.all(
      months.map(async (m) => {
        const revenueResult = await Booking.aggregate([
          { $match: { Date: { $gte: m.start, $lte: m.end } } },
          { $lookup: { from: "BookingDetail", localField: "BookingID", foreignField: "BookingID", as: "details" } },
          { $unwind: "$details" },
          { $lookup: { from: "Ticket", localField: "details.TicketID", foreignField: "TicketID", as: "ticket" } },
          { $unwind: "$ticket" },
          { $match: { "ticket.EventID": { $in: myEventIds } } },
          { $group: { _id: null, total: { $sum: "$details.PriceAtBooking" } } },
        ]);
        const sales = (revenueResult[0] && revenueResult[0].total) || 0;
        return { month: m.month, sales };
      }),
    );
    res.set("Cache-Control", "private, max-age=30");
    return res.json(chartData);
  } catch (err) {
    console.error("Organizer chart error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

function ageFromDateOfBirth(dob) {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function ageRangeForAge(age) {
  if (age < 18) return null;
  if (age <= 24) return "18-24";
  if (age <= 34) return "25-34";
  if (age <= 44) return "35-44";
  return "45+";
}

const AGE_RANGES = ["18-24", "25-34", "35-44", "45+"];

// Organizer: attendee demographics from ticket owners (age, city, ticket category mix)
exports.getOrganizerDemographics = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const myEvents = await Event.find({ organizer: userId }).select("EventID").lean();
    const myEventIds = myEvents.map((e) => e.EventID);
    if (myEventIds.length === 0) {
      return res.json({
        attendeeCount: 0,
        ageKnownCount: 0,
        ageDistribution: AGE_RANGES.map((range) => ({ range, count: 0, percent: 0 })),
        topLocations: [],
        ticketTypes: [],
      });
    }

    const [ownerRows, ticketTypeRows] = await Promise.all([
      Ticket.aggregate([
        {
          $match: {
            EventID: { $in: myEventIds },
            OwnerUserId: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: "$OwnerUserId" } },
      ]),
      Ticket.aggregate([
        {
          $match: {
            EventID: { $in: myEventIds },
            OwnerUserId: { $exists: true, $ne: null },
          },
        },
        {
          $lookup: {
            from: "TicketCategory",
            localField: "TicketCatID",
            foreignField: "TicketCatID",
            as: "cat",
          },
        },
        { $unwind: "$cat" },
        { $match: { "cat.EventID": { $in: myEventIds } } },
        { $group: { _id: "$cat.Name", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const ownerIds = ownerRows.map((row) => row._id);
    const attendeeCount = ownerIds.length;

    const [usersWithDob, profiles] = await Promise.all([
      User.find({ _id: { $in: ownerIds }, dateOfBirth: { $exists: true, $ne: null } })
        .select("dateOfBirth")
        .lean(),
      UserProfile.find({ userId: { $in: ownerIds }, City: { $exists: true, $ne: "" } })
        .select("userId City")
        .lean(),
    ]);

    const ageCounts = Object.fromEntries(AGE_RANGES.map((range) => [range, 0]));
    let ageKnownCount = 0;
    for (const user of usersWithDob) {
      const age = ageFromDateOfBirth(user.dateOfBirth);
      if (age == null) continue;
      const range = ageRangeForAge(age);
      if (!range) continue;
      ageCounts[range] += 1;
      ageKnownCount += 1;
    }

    const ageDistribution = AGE_RANGES.map((range) => ({
      range,
      count: ageCounts[range],
      percent: ageKnownCount > 0 ? Math.round((ageCounts[range] / ageKnownCount) * 100) : 0,
    }));

    const cityOwners = new Map();
    for (const profile of profiles) {
      const city = String(profile.City || "").trim();
      if (!city) continue;
      const key = city.replace(/\s+/g, " ");
      if (!cityOwners.has(key)) cityOwners.set(key, new Set());
      cityOwners.get(key).add(String(profile.userId));
    }
    const topLocations = [...cityOwners.entries()]
      .map(([city, owners]) => ({ city, count: owners.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const ticketSoldTotal = ticketTypeRows.reduce((sum, row) => sum + row.count, 0);
    const ticketTypes = ticketTypeRows.map((row) => ({
      type: row._id || "Unknown",
      count: row.count,
      percent: ticketSoldTotal > 0 ? Math.round((row.count / ticketSoldTotal) * 100) : 0,
    }));

    res.set("Cache-Control", "private, max-age=30");
    return res.json({
      attendeeCount,
      ageKnownCount,
      ageDistribution,
      topLocations,
      ticketTypes,
    });
  } catch (err) {
    console.error("Organizer demographics error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
