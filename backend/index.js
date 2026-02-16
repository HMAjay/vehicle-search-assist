const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
require("dotenv").config();
const Message = require("./models/Message.js");

const app = express();
app.use(cors({
  origin: "*"
}));
app.use(express.json());

/* ------------------ DATABASE ------------------ */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("Mongo error", err));

/* ------------------ USER MODEL ------------------ */
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  name: String,
  vehicleName: String,
  vehicleNumber: { type: String, unique: true },
  password: String
});

const User = mongoose.model("User", userSchema);

/* ------------------ OTP STORAGE (temporary) ------------------ */
const otpStore = {}; // { email: otp }

/* ------------------ SEND OTP ------------------ */
app.post("/auth/send-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email required" });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(400).json({ message: "Email already registered" });
  }

  const otp = "123456"; // demo OTP
  otpStore[email] = otp;

  console.log(`OTP for ${email}: ${otp}`);
  res.json({ message: "OTP sent" });
});

/* ------------------ VERIFY OTP ------------------ */
app.post("/auth/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  if (otpStore[email] !== otp) {
    return res.status(401).json({ message: "Invalid OTP" });
  }

  delete otpStore[email];
  res.json({ message: "OTP verified" });
});

/* ------------------ REGISTER USER ------------------ */
app.post("/auth/register", async (req, res) => {
  try {
    const { email, name, vehicleName, vehicleNumber, password } = req.body;

    if (!email || !name || !vehicleName || !vehicleNumber || !password) {
      return res.status(400).json({ message: "All fields required" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "User already exists" });
    }

    // 🔐 HASH PASSWORD
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      email,
      name,
      vehicleName,
      vehicleNumber,
      password: hashedPassword
    });

    await user.save();

    res.json({ message: "Account created" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ------------------ LOGIN ------------------ */
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 🔑 Compare password with hash
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({
  message: "Login successful",
  user: {
    _id: user._id,   // 🔥 REQUIRED FOR CHAT
    email: user.email,
    name: user.name,
    vehicleName: user.vehicleName,
    vehicleNumber: user.vehicleNumber
  }
});


  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/vehicles/:vnum", async (req, res) => {
  const vehicle = await User.findOne({ vehicleNumber: req.params.vnum });

  if (!vehicle) {
    return res.status(404).json({ message: "Vehicle not found" });
  }

  res.json({
    ownerId: vehicle._id,
    ownerName: vehicle.name,
    vehicleName: vehicle.vehicleName
  });
});

app.post("/messages/send", async (req, res) => {
  try {
    const { senderId, receiverId, text } = req.body;

    if (!senderId || !receiverId || !text) {
      return res.status(400).json({ message: "All fields required" });
    }

    const message = new Message({
      sender: senderId,
      receiver: receiverId,
      text
    });

    await message.save();

    res.json({ message: "Message sent successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/messages/chat/:otherUserId/:myUserId", async (req, res) => {
  try {
    const { otherUserId, myUserId } = req.params;

    // 🔴 STEP 1 — Mark messages as seen
    await Message.updateMany(
      {
        sender: otherUserId,
        receiver: myUserId,
        seen: false
      },
      { seen: true }
    );

    // 🟢 STEP 2 — Fetch conversation
    const messages = await Message.find({
      $or: [
        { sender: myUserId, receiver: otherUserId },
        { sender: otherUserId, receiver: myUserId }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/messages/inbox/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const messages = await Message.find({
      $or: [{ sender: userId }, { receiver: userId }]
    })
      .sort({ createdAt: -1 })
      .populate("sender", "name")
      .populate("receiver", "name");

    const conversations = {};

    messages.forEach(msg => {
      const otherUser =
        msg.sender._id.toString() === userId
          ? msg.receiver
          : msg.sender;

      // Create conversation entry if not exists
      if (!conversations[otherUser._id]) {
        conversations[otherUser._id] = {
          userId: otherUser._id,
          name: otherUser.name,
          hasUnread: false
        };
      }

      // 🔴 Mark unread ONLY if message is received and unseen
      if (
        msg.receiver._id.toString() === userId &&
        msg.seen === false
      ) {
        conversations[otherUser._id].hasUnread = true;
      }
    });

    res.json(Object.values(conversations));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
app.get("/", (req, res) => {
  res.send("Backend is running successfully");
});

/* ------------------ START SERVER ------------------ */
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
