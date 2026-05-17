export interface Database {
  public: {
    Tables: {
      locations: {
        Row: Location
        Insert: Omit<Location, 'id' | 'created_at'>
        Update: Partial<Omit<Location, 'id' | 'created_at'>>
      }
      employees: {
        Row: Employee
        Insert: Omit<Employee, 'id' | 'created_at'>
        Update: Partial<Omit<Employee, 'id' | 'created_at'>>
      }
      products: {
        Row: Product
        Insert: Omit<Product, 'id' | 'created_at' | 'chefsculinar_id' | 'chefsculinar_unit' | 'chefsculinar_unit_qty'> & { chefsculinar_id?: string | null; chefsculinar_unit?: string | null; chefsculinar_unit_qty?: number | null }
        Update: Partial<Omit<Product, 'id' | 'created_at'>>
      }
      orders: {
        Row: Order
        Insert: Omit<Order, 'id' | 'created_at'>
        Update: Partial<Omit<Order, 'id' | 'created_at'>>
      }
      order_items: {
        Row: OrderItem
        Insert: Omit<OrderItem, 'id'>
        Update: Partial<Omit<OrderItem, 'id'>>
      }
    }
  }
}

export interface Location {
  id: string
  name: string
  created_at: string
  chefsculinar_customer_id: string | null
}

export interface Employee {
  id: string
  name: string
  location_id: string
  active: boolean
  created_at: string
}

export interface Product {
  id: string
  name: string
  vendor_name: string | null
  image_url: string | null
  category: string
  vendor: string
  unit: string
  active: boolean
  sort_order: number
  created_at: string
  chefsculinar_id: string | null
  chefsculinar_unit: string | null
  chefsculinar_unit_qty: number | null
}

export interface Order {
  id: string
  location_id: string
  employee_id: string
  status: 'pending' | 'done'
  note: string | null
  created_at: string
  completed_at: string | null
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  quantity: number
  vendor_override: string | null
  notify_excluded: boolean
}

export interface OrderWithDetails extends Order {
  location: Location | null
  employee: Employee | null
  items: (OrderItem & { product: Product | null })[]
}
