const UserNotification = require("../models/UserNotification");

function uid(req) {
  return req.user?.id;
}

exports.listMine = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const rows = await UserNotification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const unread = await UserNotification.countDocuments({ userId, read: false });
    return res.json({ notifications: rows, unread });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.markRead = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const r = await UserNotification.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { read: true } },
      { new: true }
    ).lean();
    if (!r) return res.status(404).json({ message: "Not found" });
    const unread = await UserNotification.countDocuments({ userId, read: false });
    return res.json({ ok: true, unread });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    await UserNotification.updateMany({ userId, read: false }, { $set: { read: true } });
    return res.json({ ok: true, unread: 0 });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
};
