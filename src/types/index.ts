export type UserRole = "guest" | "retail" | "bulk_buyer" | "admin";
export type BulkStatus = "approved" | "pending" | "rejected" | null;

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  avatar?: string;
  joinedDate?: string;
  status?: string;
  bulkStatus?: BulkStatus;
  businessName?: string;
  businessType?: string;
  totalOrders?: number;
  totalSpent?: number;
  bulkSavings?: number;
}

export interface BulkPricingTier {
  minQty: number;
  maxQty: number | null;
  price: number;
}

export interface ProductReview {
  id: string;
  author: string;
  rating: number;
  comment: string;
  date: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  sku: string;
  category: string;
  description: string;
  retailPrice: number;
  bulkPricingTiers: BulkPricingTier[];
  stock: number;
  moq?: number;
  images: string[];
  featured?: boolean;
  tags?: string[];
  reviews?: ProductReview[];
}

export interface OrderItem {
  id?: string;
  productId?: string;
  productName?: string;
  name?: string;
  slug?: string;
  sku: string;
  image?: string;
  retailPrice?: number;
  bulkPricingTiers?: BulkPricingTier[];
  qty: number;
  isBulkPriced?: boolean;
  unitPrice: number;
  lineTotal?: number;
}

export type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";

export interface Order {
  id: string;
  date: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  deliveryAddress: string;
  isBulkOrder?: boolean;
  items: OrderItem[];
  subtotal: number;
  vat: number;
  total: number;
  bulkSavings: number;
  status: OrderStatus;
  estimatedDelivery?: string;
  adminNotes?: string;
}

export type ApplicationStatus = "pending" | "approved" | "rejected";

export interface WholesaleApplication {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  cellphone?: string;
  businessType?: string;
  businessRegistration?: string;
  shopAddress?: string;
  shopCity?: string;
  shopProvince?: string;
  shopPostalCode?: string;
  taxNumber?: string;
  estimatedMonthlySpend?: string;
  monthlyOrderValue?: string;
  notes?: string;
  appliedDate: string;
  submittedAt?: string;
  status: ApplicationStatus;
  shopPhotos?: string[];
  approvedDate?: string;
  rejectedDate?: string;
  rejectionReason?: string;
  adminNotes?: string;
}

export interface ContentData {
  heroHeading: string;
  heroSubtext: string;
  promoBannerText: string;
  featuredProductIds: string[];
}
