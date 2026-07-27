import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { DataStore } from "../../data/dataStore";
import { env } from "../../config/env";
import { AuthRequest } from "../../middleware/auth";
import {
  loginSchema,
  registerSchema,
  generateAccessToken,
  generateRefreshToken,
  sanitizeUser,
} from "./auth.service";

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parse = loginSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, message: "Invalid request payload", errors: parse.error.format() });
      return;
    }

    const { email, password } = parse.data;
    const user = DataStore.users.find((u) => u.email.toLowerCase() === email.toLowerCase());

    if (!user || !user.password) {
      res.status(401).json({ success: false, message: "Invalid email or password" });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      res.status(401).json({ success: false, message: "Invalid email or password" });
      return;
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        user: sanitizeUser(user),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parse = registerSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, message: "Invalid request payload", errors: parse.error.format() });
      return;
    }

    const { name, email, password } = parse.data;
    const existing = DataStore.users.find((u) => u.email.toLowerCase() === email.toLowerCase());

    if (existing) {
      res.status(400).json({ success: false, message: "Email already registered" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = {
      id: `u-${uuidv4().slice(0, 8)}`,
      name,
      email,
      password: hashedPassword,
      role: "retail" as const,
      joinedDate: new Date().toISOString().split("T")[0],
      status: "active",
    };

    DataStore.users.push(newUser);
    DataStore.saveUsers();

    const accessToken = generateAccessToken(newUser);
    const refreshToken = generateRefreshToken(newUser);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      success: true,
      data: {
        accessToken,
        user: sanitizeUser(newUser),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      res.status(401).json({ success: false, message: "Refresh token missing" });
      return;
    }

    let payload: any;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    } catch (err) {
      res.status(401).json({ success: false, message: "Invalid or expired refresh token" });
      return;
    }

    const user = DataStore.users.find((u) => u.id === payload.id);
    if (!user) {
      res.status(401).json({ success: false, message: "User not found" });
      return;
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        user: sanitizeUser(user),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
  });
  res.status(200).json({ success: true, message: "Logged out successfully" });
}

export async function me(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const user = DataStore.users.find((u) => u.id === req.user?.id);
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        user: sanitizeUser(user),
      },
    });
  } catch (error) {
    next(error);
  }
}
