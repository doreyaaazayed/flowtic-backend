const EventCategory = require("../models/EventCategory");

// CategoryIDs hidden from public (Prom, Weddings, Private) - keep in sync with eventController
const PRIVATE_CATEGORY_IDS = require("../utils/privateEventCategories").PRIVATE_CATEGORY_IDS;

exports.list = async (req, res) => {
  try {
    const publicOnly = req.query.publicOnly === "true" || req.query.publicOnly === "1";
    const filter = publicOnly ? { CategoryID: { $nin: PRIVATE_CATEGORY_IDS } } : {};
    const categories = await EventCategory.find(filter)
      .select("CategoryID Name Description")
      .sort({ Name: 1 })
      .lean();
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    return res.json(categories);
  } catch (err) {
    console.error("List categories error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const category = await EventCategory.findById(req.params.id).lean();
    if (!category) return res.status(404).json({ message: "Category not found" });
    return res.json(category);
  } catch (err) {
    console.error("Get category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { Name, Description } = req.body || {};
    if (!Name) {
      return res.status(400).json({ message: "Name is required" });
    }
    const last = await EventCategory.findOne().sort({ CategoryID: -1 }).lean();
    const nextId = (last?.CategoryID || 0) + 1;
    const category = await EventCategory.create({
      CategoryID: nextId,
      Name: String(Name).trim(),
      Description: Description != null && String(Description).trim() !== "" ? String(Description).trim() : "",
    });
    return res.status(201).json(category);
  } catch (err) {
    console.error("Create category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const category = await EventCategory.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    const { Name, Description } = req.body || {};
    if (Name !== undefined) category.Name = Name;
    if (Description !== undefined) category.Description = Description != null ? String(Description).trim() : "";
    await category.save();
    return res.json(category);
  } catch (err) {
    console.error("Update category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.remove = async (req, res) => {
  try {
    const category = await EventCategory.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    return res.status(204).send();
  } catch (err) {
    console.error("Delete category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
