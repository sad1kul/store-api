import fs from "fs";
import path from "path";
import { User, Product, Order, WholesaleApplication, ContentData } from "../types";

const seedsDir = path.join(__dirname, "../data/seeds");

function readJson<T>(filename: string): T {
  const filePath = path.join(seedsDir, filename);
  const data = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(data);
}

function writeJson<T>(filename: string, data: T): void {
  const filePath = path.join(seedsDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export class DataStore {
  public static users: User[] = readJson<User[]>("users.json");
  public static products: Product[] = readJson<Product[]>("products.json");
  public static orders: Order[] = readJson<Order[]>("orders.json");
  public static wholesaleApplications: WholesaleApplication[] = readJson<WholesaleApplication[]>("bulk-applications.json");
  public static content: ContentData = readJson<ContentData>("content.json");

  public static saveUsers() { writeJson("users.json", this.users); }
  public static saveProducts() { writeJson("products.json", this.products); }
  public static saveOrders() { writeJson("orders.json", this.orders); }
  public static saveWholesaleApplications() { writeJson("bulk-applications.json", this.wholesaleApplications); }
  public static saveContent() { writeJson("content.json", this.content); }
}
