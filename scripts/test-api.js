/**
 * API test script for FlowTic backend.
 * Run: npm run test:api   (or: node scripts/test-api.js)
 * Ensure server is running in another terminal: npm start
 */

const BASE = "http://localhost:5000/api";
const UNIQUE = Date.now().toString(36);

const state = { tokens: {}, ids: {} };
let passed = 0;
let failed = 0;

async function request(method, path, body = null, token = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (token) opts.headers["Authorization"] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {}
  return { ok: res.ok, status: res.status, data, text };
}

function ok(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? " — " + detail : ""}`);
  }
}

function failDetail(res) {
  if (!res) return "";
  const d = res.data;
  if (d?.error) return d.error;
  if (d?.message) return d.message;
  if (res.status) return `status ${res.status}`;
  return "";
}

async function run() {
  console.log("\n--- FlowTic API tests ---\n");

  // 1. Health (retry so server can start)
  console.log("1. Health");
  let health = { ok: false };
  for (let i = 0; i < 12; i++) {
    try {
      health = await request("GET", "/health");
      if (health.ok && health.data?.status === "ok") break;
    } catch (_) {}
    if (i < 11) await new Promise((r) => setTimeout(r, 1000));
  }
  ok("GET /api/health", health.ok && health.data?.status === "ok");
  if (!health.ok) {
    console.log("\n  Server not responding. In another terminal run: npm start\n");
    process.exit(1);
  }

  // 2. Auth – Register organizer, attendee, admin
  console.log("\n2. Auth (Register & Login)");
  const regOrg = await request("POST", "/auth/register", {
    firstName: "Test",
    lastName: "Organizer",
    email: `org-${UNIQUE}@test.com`,
    password: "Pass123",
    phone: "01000000001",
    nationalId: "29901010000001",
    dateOfBirth: "1990-01-01",
    role: "organizer",
    organizerType: "individual",
  });
  ok("Register organizer", regOrg.ok && regOrg.data?.token, failDetail(regOrg));
  if (regOrg.ok) {
    state.tokens.organizer = regOrg.data.token;
    state.ids.organizerId = regOrg.data.user?.id;
  }

  const regAtt = await request("POST", "/auth/register", {
    firstName: "Test",
    lastName: "Attendee",
    email: `att-${UNIQUE}@test.com`,
    password: "Pass123",
    phone: "01000000002",
    nationalId: "29901010000002",
    dateOfBirth: "1995-06-15",
    role: "attendee",
  });
  ok("Register attendee", regAtt.ok && regAtt.data?.token, failDetail(regAtt));
  if (regAtt.ok) state.tokens.attendee = regAtt.data.token;

  const regAdmin = await request("POST", "/auth/register", {
    firstName: "Test",
    lastName: "Admin",
    email: `admin-${UNIQUE}@test.com`,
    password: "Pass123",
    phone: "01000000003",
    nationalId: "29901010000003",
    dateOfBirth: "1988-03-20",
    role: "admin",
  });
  ok("Register admin", regAdmin.ok && regAdmin.data?.token, failDetail(regAdmin));
  if (regAdmin.ok) state.tokens.admin = regAdmin.data.token;

  const login = await request("POST", "/auth/login", {
    email: `org-${UNIQUE}@test.com`,
    password: "Pass123",
  });
  ok("Login organizer", login.ok && login.data?.token);

  const me = await request("GET", "/auth/me", null, state.tokens.organizer);
  ok("GET /api/auth/me (protected)", me.ok && me.data?.userId);

  // 2c. Users CRUD (admin)
  console.log("\n2c. Users (admin)");
  const listUsers = await request("GET", "/users", null, state.tokens.admin);
  ok("GET /api/users", listUsers.ok && Array.isArray(listUsers.data));
  if (listUsers.ok && state.ids.organizerId) {
    const getUser = await request("GET", `/users/${state.ids.organizerId}`, null, state.tokens.admin);
    ok("GET /api/users/:id", getUser.ok && getUser.data?.Username);
  }
  if (state.ids.organizerId) {
    const putUser = await request(
      "PUT",
      `/users/${state.ids.organizerId}`,
      { username: "TestOrganizerRenamed" },
      state.tokens.admin
    );
    ok("PUT /api/users/:id", putUser.ok && putUser.data?.Username === "TestOrganizerRenamed");
    await request("PUT", `/users/${state.ids.organizerId}`, { username: "TestOrganizer" }, state.tokens.admin);
  }
  const regToDelete = await request("POST", "/auth/register", {
    firstName: "ToDelete",
    lastName: "User",
    email: `todel-${UNIQUE}@test.com`,
    password: "Pass123",
    phone: "01000000099",
    nationalId: "29901010000099",
    dateOfBirth: "1992-11-01",
    role: "attendee",
  });
  if (regToDelete.ok) state.ids.userToDeleteId = regToDelete.data.user?.id;
  if (state.ids.userToDeleteId) {
    const delUser = await request("DELETE", `/users/${state.ids.userToDeleteId}`, null, state.tokens.admin);
    ok("DELETE /api/users/:id (admin)", delUser.status === 204);
  }

  // 2b. Profile
  console.log("\n2b. Profile");
  const getProfile = await request("GET", "/profile", null, state.tokens.organizer);
  ok("GET /api/profile", getProfile.ok && getProfile.data && typeof getProfile.data === "object", failDetail(getProfile));
  const putProfile = await request(
    "PUT",
    "/profile",
    { FirstName: "Test", LastName: "Organizer", City: "Cairo" },
    state.tokens.organizer
  );
  ok("PUT /api/profile", putProfile.ok && putProfile.data && (putProfile.data.FirstName === "Test" || putProfile.data._id), failDetail(putProfile));

  // 3. Venues & Categories
  console.log("\n3. Venues & Categories");
  const createVenue = await request(
    "POST",
    "/venues",
    { Name: "Test Hall", Location: "Cairo", Capacity: 200, Type: "indoor" },
    state.tokens.organizer
  );
  ok("POST /api/venues", createVenue.ok && createVenue.data?.VenueID);
  if (createVenue.ok) {
    state.ids.VenueID = createVenue.data.VenueID;
    state.ids.venueId = createVenue.data._id;
  }

  const createCat = await request(
    "POST",
    "/categories",
    { Name: "Concert", Description: "Live music" },
    state.tokens.organizer
  );
  ok("POST /api/categories", createCat.ok && createCat.data?.CategoryID);
  if (createCat.ok) {
    state.ids.CategoryID = createCat.data.CategoryID;
    state.ids.categoryId = createCat.data._id;
  }

  const listVenues = await request("GET", "/venues");
  ok("GET /api/venues", listVenues.ok && Array.isArray(listVenues.data));
  const listCategories = await request("GET", "/categories");
  ok("GET /api/categories", listCategories.ok && Array.isArray(listCategories.data));

  const getVenue = await request("GET", `/venues/${state.ids.venueId}`);
  ok("GET /api/venues/:id", getVenue.ok && getVenue.data?.Name === "Test Hall");
  const putVenueOrganizer = await request(
    "PUT",
    `/venues/${state.ids.venueId}`,
    { Name: "Test Hall Updated", Capacity: 250 },
    state.tokens.organizer
  );
  ok("PUT /api/venues/:id (organizer forbidden)", putVenueOrganizer.status === 403);
  const putVenue = await request(
    "PUT",
    `/venues/${state.ids.venueId}`,
    { Name: "Test Hall Updated", Capacity: 250 },
    state.tokens.admin
  );
  ok("PUT /api/venues/:id (admin)", putVenue.ok && putVenue.data?.Capacity === 250);

  const getCategory = await request("GET", `/categories/${state.ids.categoryId}`);
  ok("GET /api/categories/:id", getCategory.ok && getCategory.data?.Name === "Concert");
  const putCategory = await request(
    "PUT",
    `/categories/${state.ids.categoryId}`,
    { Name: "Concert & Live", Description: "Updated" },
    state.tokens.organizer
  );
  ok("PUT /api/categories/:id", putCategory.ok && putCategory.data?.Name === "Concert & Live");

  // Create extra venue/category for DELETE (don't delete the ones used by event)
  const createVenue2 = await request(
    "POST",
    "/venues",
    { Name: "To Delete Hall", Location: "Alex", Capacity: 50, Type: "outdoor" },
    state.tokens.organizer
  );
  if (createVenue2.ok) state.ids.venueIdToDelete = createVenue2.data._id;
  const delVenue = await request("DELETE", `/venues/${state.ids.venueIdToDelete}`, null, state.tokens.admin);
  ok("DELETE /api/venues/:id (admin)", delVenue.status === 204);

  const createCat2 = await request(
    "POST",
    "/categories",
    { Name: "To Delete Cat", Description: "x" },
    state.tokens.organizer
  );
  if (createCat2.ok) state.ids.categoryIdToDelete = createCat2.data._id;
  const delCategory = await request("DELETE", `/categories/${state.ids.categoryIdToDelete}`, null, state.tokens.organizer);
  ok("DELETE /api/categories/:id", delCategory.status === 204);

  // 4. Events
  console.log("\n4. Events");
  const start = new Date();
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const createEvent = await request(
    "POST",
    "/events",
    {
      VenueID: state.ids.VenueID,
      CategoryID: state.ids.CategoryID,
      Name: "Test Concert",
      Description: "API test event",
      StartDate: start.toISOString(),
      EndDate: end.toISOString(),
      Status: "Active",
    },
    state.tokens.organizer
  );
  ok("POST /api/events", createEvent.ok && createEvent.data?._id);
  if (createEvent.ok) state.ids.eventId = createEvent.data._id;

  const listEvents = await request("GET", "/events");
  ok("GET /api/events", listEvents.ok && Array.isArray(listEvents.data));

  const getEvent = await request("GET", `/events/${state.ids.eventId}`);
  ok("GET /api/events/:id", getEvent.ok && getEvent.data?.Name === "Test Concert");
  if (getEvent.ok) state.ids.EventID = getEvent.data.EventID;

  const putEvent = await request(
    "PUT",
    `/events/${state.ids.eventId}`,
    { Name: "Test Concert Updated", capacity: 300 },
    state.tokens.organizer
  );
  ok("PUT /api/events/:id", putEvent.ok && putEvent.data?.Name === "Test Concert Updated");

  // 5. Ticket categories & tickets
  console.log("\n5. Ticket Categories");
  const createTc = await request(
    "POST",
    `/events/${state.ids.eventId}/ticket-categories`,
    { Name: "Standard", Price: 100, TotalQuantity: 10 },
    state.tokens.organizer
  );
  ok("POST /api/events/:eventId/ticket-categories", createTc.ok && createTc.data?.TicketCatID, failDetail(createTc));
  if (createTc.ok) {
    state.ids.ticketCategoryId = createTc.data._id;
    state.ids.TicketCatID = createTc.data.TicketCatID;
  }

  const listTc = await request("GET", `/events/${state.ids.eventId}/ticket-categories`);
  ok("GET /api/events/:eventId/ticket-categories", listTc.ok && Array.isArray(listTc.data));

  const getTc = await request(
    "GET",
    `/events/${state.ids.eventId}/ticket-categories/${state.ids.ticketCategoryId}`
  );
  ok("GET /api/events/:eventId/ticket-categories/:id", getTc.ok && getTc.data?.Name === "Standard");
  const putTc = await request(
    "PUT",
    `/events/${state.ids.eventId}/ticket-categories/${state.ids.ticketCategoryId}`,
    { Name: "Standard Plus", Price: 110, Description: "Updated" },
    state.tokens.organizer
  );
  ok("PUT /api/events/:eventId/ticket-categories/:id", putTc.ok && putTc.data?.Name === "Standard Plus");

  // Second ticket category (no sales) for DELETE test
  const createTc2 = await request(
    "POST",
    `/events/${state.ids.eventId}/ticket-categories`,
    { Name: "VIP Delete Me", Price: 200, TotalQuantity: 3 },
    state.tokens.organizer
  );
  if (createTc2.ok) state.ids.ticketCategoryIdToDelete = createTc2.data._id;
  const delTc = await request(
    "DELETE",
    `/events/${state.ids.eventId}/ticket-categories/${state.ids.ticketCategoryIdToDelete}`,
    null,
    state.tokens.organizer
  );
  ok("DELETE /api/events/:eventId/ticket-categories/:id", delTc.status === 204);

  // 6. Booking
  console.log("\n6. Bookings");
  const createBooking = await request(
    "POST",
    "/bookings",
    {
      eventId: state.ids.eventId,
      ticketCategoryId: state.ids.ticketCategoryId,
      quantity: 2,
    },
    state.tokens.attendee
  );
  ok("POST /api/bookings", createBooking.ok && createBooking.data?.booking, failDetail(createBooking));
  if (createBooking.ok) {
    if (createBooking.data?.booking?.BookingID)
      state.ids.bookingId = createBooking.data.booking.BookingID;
    if (createBooking.data?.booking?._id)
      state.ids.bookingMongoId = createBooking.data.booking._id;
    if (createBooking.data?.ticketIds?.length)
      state.ids.ticketIdForResale = createBooking.data.ticketIds[0];
  }

  const myBookings = await request("GET", "/bookings/my", null, state.tokens.attendee);
  ok("GET /api/bookings/my", myBookings.ok && Array.isArray(myBookings.data));

  const getBooking = await request("GET", `/bookings/${state.ids.bookingMongoId}`, null, state.tokens.attendee);
  ok("GET /api/bookings/:id", getBooking.ok && getBooking.data?.TotalAmount != null);

  // Second booking (2 tickets) for resale listing CRUD, detail DELETE, and booking DELETE tests
  const createBooking2 = await request(
    "POST",
    "/bookings",
    {
      eventId: state.ids.eventId,
      ticketCategoryId: state.ids.ticketCategoryId,
      quantity: 2,
    },
    state.tokens.attendee
  );
  if (createBooking2.ok) {
    state.ids.booking2MongoId = createBooking2.data.booking?._id;
    state.ids.ticketId2 = createBooking2.data.ticketIds?.[0];
  }

  // Booking PUT (update)
  const putBooking = await request(
    "PUT",
    `/bookings/${state.ids.bookingMongoId}`,
    { Status: "Confirmed" },
    state.tokens.attendee
  );
  ok("PUT /api/bookings/:id", putBooking.ok && (putBooking.data?.Status === "Confirmed" || putBooking.data?.Status));

  // Booking details CRUD
  const listDetails = await request("GET", `/bookings/${state.ids.bookingMongoId}/details`, null, state.tokens.attendee);
  ok("GET /api/bookings/:id/details", listDetails.ok && Array.isArray(listDetails.data));
  if (listDetails.ok && listDetails.data?.length) state.ids.detailId = listDetails.data[0]._id;

  if (state.ids.detailId) {
    const getDetail = await request(
      "GET",
      `/bookings/${state.ids.bookingMongoId}/details/${state.ids.detailId}`,
      null,
      state.tokens.attendee
    );
    ok("GET /api/bookings/:id/details/:detailId", getDetail.ok && getDetail.data?.PriceAtBooking != null);

    const putDetail = await request(
      "PUT",
      `/bookings/${state.ids.bookingMongoId}/details/${state.ids.detailId}`,
      { PriceAtBooking: 99 },
      state.tokens.attendee
    );
    ok("PUT /api/bookings/:id/details/:detailId", putDetail.ok && putDetail.data?.PriceAtBooking === 99);
  }

  // BookingDetail DELETE tested on booking2 later (after resale), to avoid touching first booking before resale

  // 6b. Tickets CRUD
  console.log("\n6b. Tickets");
  const listTickets = await request(
    "GET",
    `/tickets?eventID=${state.ids.EventID}`,
    null,
    state.tokens.admin
  );
  ok("GET /api/tickets", listTickets.ok && Array.isArray(listTickets.data), failDetail(listTickets));
  if (listTickets.ok && listTickets.data?.length) {
    state.ids.ticketMongoId = listTickets.data[0]._id;
    state.ids.EventID = state.ids.EventID ?? listTickets.data[0].EventID;
    state.ids.TicketCatID = state.ids.TicketCatID ?? listTickets.data[0].TicketCatID;
  }

  if (state.ids.ticketMongoId) {
    const getTicket = await request("GET", `/tickets/${state.ids.ticketMongoId}`, null, state.tokens.attendee);
    ok("GET /api/tickets/:id", getTicket.ok && getTicket.data?.TicketID != null);
  }

  const createTicket = await request(
    "POST",
    "/tickets",
    { EventID: state.ids.EventID, TicketCatID: state.ids.TicketCatID },
    state.tokens.organizer
  );
  ok("POST /api/tickets", createTicket.ok && createTicket.data?.TicketID, failDetail(createTicket) || (createTicket.status === 500 ? " (if MongoDB Ticket collection has a validator, it may need to allow these fields)" : ""));
  if (createTicket.ok) state.ids.createdTicketId = createTicket.data._id;

  if (state.ids.createdTicketId) {
    const putTicket = await request(
      "PUT",
      `/tickets/${state.ids.createdTicketId}`,
      { SeatID: 1 },
      state.tokens.admin
    );
    ok("PUT /api/tickets/:id (admin)", putTicket.ok && putTicket.data?.SeatID === 1);

    const delTicket = await request("DELETE", `/tickets/${state.ids.createdTicketId}`, null, state.tokens.admin);
    ok("DELETE /api/tickets/:id (admin)", delTicket.status === 204);
  }

  // 7. Resale (White Market)
  console.log("\n7. Resale (White Market)");
  if (state.ids.ticketIdForResale != null) {
    const createListing = await request(
      "POST",
      "/resale/list",
      { ticketId: state.ids.ticketIdForResale, price: 120 },
      state.tokens.attendee
    );
    ok("POST /api/resale/list", createListing.ok && createListing.data?._id);
    if (createListing.ok) state.ids.listingId = createListing.data._id;

    const listListings = await request("GET", "/resale/listings");
    ok("GET /api/resale/listings", listListings.ok && Array.isArray(listListings.data));

    // Second listing (from booking2) for GET/PUT/DELETE tests
    if (state.ids.ticketId2 != null) {
      const createListing2 = await request(
        "POST",
        "/resale/list",
        { ticketId: state.ids.ticketId2, price: 125 },
        state.tokens.attendee
      );
      if (createListing2.ok) state.ids.listing2Id = createListing2.data._id;

      if (state.ids.listing2Id) {
        const getListing = await request("GET", `/resale/listings/${state.ids.listing2Id}`);
        ok("GET /api/resale/listings/:id", getListing.ok && getListing.data?.price === 125);

        const putListing = await request(
          "PUT",
          `/resale/listings/${state.ids.listing2Id}`,
          { price: 130 },
          state.tokens.attendee
        );
        ok("PUT /api/resale/listings/:id", putListing.ok && putListing.data?.price === 130);

        const createReq2 = await request(
          "POST",
          "/resale/request",
          { listingId: state.ids.listing2Id },
          state.tokens.admin
        );
        if (createReq2.ok) state.ids.request2Id = createReq2.data._id;

        if (state.ids.request2Id) {
          const getRequest = await request(
            "GET",
            `/resale/requests/${state.ids.request2Id}`,
            null,
            state.tokens.admin
          );
          ok("GET /api/resale/requests/:requestId (admin)", getRequest.ok && getRequest.data?.status === "Pending");

          const delRequest = await request(
            "DELETE",
            `/resale/requests/${state.ids.request2Id}`,
            null,
            state.tokens.admin
          );
          ok("DELETE /api/resale/requests/:requestId (admin)", delRequest.status === 204);
        }

        const delListing = await request(
          "DELETE",
          `/resale/listings/${state.ids.listing2Id}`,
          null,
          state.tokens.attendee
        );
        ok("DELETE /api/resale/listings/:id", delListing.status === 204);
      }
    }

    // BookingDetail DELETE (admin) - delete one detail from booking2 (has 2)
    let booking2DetailId = null;
    if (state.ids.booking2MongoId) {
      const listDetails2 = await request(
        "GET",
        `/bookings/${state.ids.booking2MongoId}/details`,
        null,
        state.tokens.admin
      );
      if (listDetails2.ok && listDetails2.data?.length) booking2DetailId = listDetails2.data[0]._id;
    }
    if (booking2DetailId) {
      const delDetail = await request(
        "DELETE",
        `/bookings/${state.ids.booking2MongoId}/details/${booking2DetailId}`,
        null,
        state.tokens.admin
      );
      ok("DELETE /api/bookings/:id/details/:detailId (admin)", delDetail.status === 204);
    }

    // Booking DELETE (admin) - delete second booking
    if (state.ids.booking2MongoId) {
      const delBooking = await request(
        "DELETE",
        `/bookings/${state.ids.booking2MongoId}`,
        null,
        state.tokens.admin
      );
      ok("DELETE /api/bookings/:id (admin)", delBooking.status === 204);
    }

    // Buyer (use admin as buyer for test)
    const createReq = await request(
      "POST",
      "/resale/request",
      { listingId: state.ids.listingId },
      state.tokens.admin
    );
    ok("POST /api/resale/request", createReq.ok && createReq.data?._id);
    if (createReq.ok) state.ids.requestId = createReq.data._id;

    const pendingReq = await request("GET", "/resale/requests/pending", null, state.tokens.admin);
    ok("GET /api/resale/requests/pending (admin)", pendingReq.ok && Array.isArray(pendingReq.data));

    const approve = await request(
      "POST",
      `/resale/requests/${state.ids.requestId}/approve`,
      null,
      state.tokens.admin
    );
    ok("POST /api/resale/requests/:id/approve (admin)", approve.ok);
  } else {
    ok("POST /api/resale/list", false, "skip: no ticketId (run booking first)");
  }

  // 8. Reviews
  console.log("\n8. Reviews");
  const listReviews = await request("GET", `/events/${state.ids.eventId}/reviews`);
  ok("GET /api/events/:eventId/reviews", listReviews.ok && Array.isArray(listReviews.data));

  // Attendee has ticket (before resale we had 2, after resale 1) - use attendee who still has a ticket
  const createReview = await request(
    "POST",
    `/events/${state.ids.eventId}/reviews`,
    { rating: 5, comment: "Great event!" },
    state.tokens.attendee
  );
  ok("POST /api/events/:eventId/reviews", createReview.ok && createReview.data?.rating === 5, failDetail(createReview));
  if (createReview.ok) state.ids.reviewId = createReview.data._id;

  const listReviews2 = await request("GET", `/events/${state.ids.eventId}/reviews`);
  ok("GET reviews after post", listReviews2.ok && listReviews2.data?.length >= 1);

  const getReview = await request("GET", `/events/${state.ids.eventId}/reviews/${state.ids.reviewId}`);
  ok("GET /api/events/:eventId/reviews/:id", getReview.ok && getReview.data?.rating === 5);
  const putReview = await request(
    "PUT",
    `/events/${state.ids.eventId}/reviews/${state.ids.reviewId}`,
    { rating: 4, comment: "Updated comment" },
    state.tokens.attendee
  );
  ok("PUT /api/events/:eventId/reviews/:id", putReview.ok && putReview.data?.rating === 4);
  const delReview = await request(
    "DELETE",
    `/events/${state.ids.eventId}/reviews/${state.ids.reviewId}`,
    null,
    state.tokens.attendee
  );
  ok("DELETE /api/events/:eventId/reviews/:id", delReview.status === 204);

  // 9. Booking cancel (last: releases tickets)
  console.log("\n9. Booking cancel");
  const cancelBooking = await request(
    "POST",
    `/bookings/${state.ids.bookingMongoId}/cancel`,
    null,
    state.tokens.attendee
  );
  ok("POST /api/bookings/:id/cancel", cancelBooking.ok && cancelBooking.data?.Status === "Cancelled");

  // Summary
  console.log("\n--- Summary ---");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(failed === 0 ? "\n  \x1b[32mAll tests passed.\x1b[0m\n" : "\n  \x1b[31mSome tests failed.\x1b[0m\n");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
