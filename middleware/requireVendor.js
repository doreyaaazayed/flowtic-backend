const { getVendorForUser } = require("../services/vendorService");

/** Requires auth + vendor role + active Vendor profile linked to user. */
async function requireVendor(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Authorization required" });
  }
  if (req.user.role !== "vendor") {
    return res.status(403).json({ message: "Vendor access only" });
  }
  try {
    const vendor = await getVendorForUser(req.user.id);
    if (!vendor) {
      return res.status(403).json({
        message: "No vendor profile linked to this account. Contact an administrator.",
      });
    }
    req.vendor = vendor;
    return next();
  } catch (err) {
    console.error("requireVendor:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { requireVendor };
