"""Creates shop-app, the sample project the real Codeville UI opens in the demo recordings.
A small online store: React frontend, Django REST backend, pytest tests (one of them fails on purpose:
the cart total ignores quantity), Postgres in docker-compose, Stripe and SendGrid in .env.example.

    python make_shop.py <folder>     # makes <folder>/shop-app and <folder>/origin.git (its remote)
"""
import os
import subprocess
import sys
import textwrap

base = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
root = os.path.join(base, "shop-app")
origin = os.path.join(base, "origin.git")

FILES = {
    ".gitignore": "__pycache__/\n.pytest_cache/\nnode_modules/\n.env\n",
    "README.md": """
        # shop-app

        An online store for handmade goods. Shoppers sign in, browse the catalog, fill a cart and pay with Stripe.
        Order emails go out through SendGrid.
        """,
    ".env.example": """
        DATABASE_URL=postgres://shop:shop@localhost:5432/shop
        STRIPE_SECRET_KEY=sk_test_xxx
        SENDGRID_API_KEY=SG.xxx
        """,
    "docker-compose.yml": """
        services:
          db:
            image: postgres:16
            environment:
              POSTGRES_USER: shop
              POSTGRES_PASSWORD: shop
          api:
            build: ./backend
            depends_on: [db]
        """,
    "frontend/package.json": """
        {
          "name": "shop-frontend",
          "private": true,
          "scripts": { "dev": "vite", "build": "vite build", "test": "vitest run" },
          "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1", "react-router-dom": "^6.26.0" },
          "devDependencies": { "vite": "^5.4.10", "vitest": "^2.1.0", "typescript": "^5.6.3" }
        }
        """,
    "frontend/index.html": '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n',
    "frontend/src/main.tsx": """
        import { createRoot } from 'react-dom/client';
        import { App } from './App';

        createRoot(document.getElementById('root')!).render(<App />);
        """,
    "frontend/src/App.tsx": """
        import { BrowserRouter, Route, Routes } from 'react-router-dom';
        import { Login } from './features/auth/Login';
        import { ProductList } from './features/catalog/ProductList';
        import { Cart } from './features/cart/Cart';
        import { Checkout } from './features/payment/Checkout';

        export function App() {
          return (
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<ProductList />} />
                <Route path="/login" element={<Login />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/checkout" element={<Checkout />} />
              </Routes>
            </BrowserRouter>
          );
        }
        """,
    "frontend/src/api.ts": """
        export async function get<T>(path: string): Promise<T> {
          const res = await fetch(`/api${path}`, { credentials: 'include' });
          if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
          return res.json();
        }

        export async function post<T>(path: string, body: unknown): Promise<T> {
          const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
          return res.json();
        }
        """,
    "frontend/src/features/auth/Login.tsx": """
        import { useState } from 'react';
        import { post } from '../../api';

        export function Login() {
          const [email, setEmail] = useState('');
          const [password, setPassword] = useState('');
          return (
            <form onSubmit={(e) => { e.preventDefault(); void post('/auth/login/', { email, password }); }}>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
              <button>Sign in</button>
            </form>
          );
        }
        """,
    "frontend/src/features/auth/Signup.tsx": """
        import { post } from '../../api';

        export function Signup() {
          return <button onClick={() => void post('/auth/signup/', {})}>Create account</button>;
        }
        """,
    "frontend/src/features/auth/useSession.ts": """
        import { useEffect, useState } from 'react';
        import { get } from '../../api';

        export function useSession() {
          const [user, setUser] = useState<{ email: string } | null>(null);
          useEffect(() => { void get<{ email: string }>('/auth/me/').then(setUser).catch(() => setUser(null)); }, []);
          return user;
        }
        """,
    "frontend/src/features/catalog/ProductList.tsx": """
        import { useEffect, useState } from 'react';
        import { get } from '../../api';
        import { ProductCard, type Product } from './ProductCard';

        export function ProductList() {
          const [items, setItems] = useState<Product[]>([]);
          useEffect(() => { void get<Product[]>('/catalog/products/').then(setItems); }, []);
          return <div className="grid">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>;
        }
        """,
    "frontend/src/features/catalog/ProductCard.tsx": """
        import { post } from '../../api';

        export interface Product { id: number; name: string; price: number; image: string }

        export function ProductCard({ product }: { product: Product }) {
          return (
            <article>
              <img src={product.image} alt="" />
              <h3>{product.name}</h3>
              <button onClick={() => void post('/cart/items/', { product: product.id, quantity: 1 })}>Add to cart</button>
            </article>
          );
        }
        """,
    "frontend/src/features/catalog/Search.tsx": """
        import { useState } from 'react';

        export function Search({ onSearch }: { onSearch: (q: string) => void }) {
          const [q, setQ] = useState('');
          return <input value={q} onChange={(e) => { setQ(e.target.value); onSearch(e.target.value); }} placeholder="Search" />;
        }
        """,
    "frontend/src/features/cart/Cart.tsx": """
        import { useEffect, useState } from 'react';
        import { get } from '../../api';
        import { CartItem, type Line } from './CartItem';

        export function Cart() {
          const [cart, setCart] = useState<{ lines: Line[]; total: number } | null>(null);
          useEffect(() => { void get<{ lines: Line[]; total: number }>('/cart/').then(setCart); }, []);
          if (!cart) return null;
          return (
            <section>
              {cart.lines.map((l) => <CartItem key={l.id} line={l} />)}
              <p>Total: {cart.total.toFixed(2)}</p>
            </section>
          );
        }
        """,
    "frontend/src/features/cart/CartItem.tsx": """
        export interface Line { id: number; name: string; price: number; quantity: number }

        export function CartItem({ line }: { line: Line }) {
          return <div>{line.name} x {line.quantity}</div>;
        }
        """,
    "frontend/src/features/payment/Checkout.tsx": """
        import { post } from '../../api';

        export function Checkout() {
          return <button onClick={() => void post('/payment/checkout/', {})}>Pay now</button>;
        }
        """,
    "backend/requirements.txt": "Django>=5.1\ndjangorestframework>=3.15\nstripe>=10.0\nsendgrid>=6.11\npsycopg[binary]>=3.2\npytest>=8.3\n",
    "backend/manage.py": """
        import os
        import sys

        if __name__ == "__main__":
            os.environ.setdefault("DJANGO_SETTINGS_MODULE", "store.settings")
            from django.core.management import execute_from_command_line
            execute_from_command_line(sys.argv)
        """,
    "backend/store/__init__.py": "",
    "backend/store/settings.py": """
        import os

        SECRET_KEY = os.environ.get("SECRET_KEY", "dev")
        INSTALLED_APPS = ["rest_framework", "store"]
        DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "shop"}}
        ROOT_URLCONF = "store.urls"
        """,
    "backend/store/urls.py": """
        from django.urls import path

        from . import auth, catalog, cart, payment

        urlpatterns = [
            path("api/auth/login/", auth.login),
            path("api/auth/me/", auth.me),
            path("api/catalog/products/", catalog.products),
            path("api/cart/", cart.view_cart),
            path("api/cart/items/", cart.add_item),
            path("api/payment/checkout/", payment.checkout),
        ]
        """,
    "backend/store/models.py": """
        from django.db import models


        class Product(models.Model):
            name = models.CharField(max_length=200)
            price = models.DecimalField(max_digits=8, decimal_places=2)


        class CartLine(models.Model):
            product = models.ForeignKey(Product, on_delete=models.CASCADE)
            quantity = models.PositiveIntegerField(default=1)
        """,
    "backend/store/auth.py": """
        from rest_framework.decorators import api_view
        from rest_framework.response import Response


        @api_view(["POST"])
        def login(request):
            return Response({"ok": True})


        @api_view(["GET"])
        def me(request):
            return Response({"email": getattr(request.user, "email", "")})
        """,
    "backend/store/catalog.py": """
        from rest_framework.decorators import api_view
        from rest_framework.response import Response

        from .models import Product


        @api_view(["GET"])
        def products(request):
            return Response([{"id": p.id, "name": p.name, "price": float(p.price)} for p in Product.objects.all()])
        """,
    "backend/store/pricing.py": """
        \"\"\"Cart arithmetic, kept free of Django so it is easy to test.\"\"\"


        def cart_total(lines):
            # Each line is {"price": float, "quantity": int}.
            return round(sum(line["price"] for line in lines), 2)
        """,
    "backend/store/cart.py": """
        from rest_framework.decorators import api_view
        from rest_framework.response import Response

        from .models import CartLine
        from .pricing import cart_total


        @api_view(["GET"])
        def view_cart(request):
            lines = [{"id": l.id, "name": l.product.name, "price": float(l.product.price), "quantity": l.quantity} for l in CartLine.objects.all()]
            return Response({"lines": lines, "total": cart_total(lines)})


        @api_view(["POST"])
        def add_item(request):
            CartLine.objects.create(product_id=request.data["product"], quantity=request.data.get("quantity", 1))
            return Response({"ok": True})
        """,
    "backend/store/payment.py": """
        import os

        import stripe
        from rest_framework.decorators import api_view
        from rest_framework.response import Response

        stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")


        @api_view(["POST"])
        def checkout(request):
            intent = stripe.PaymentIntent.create(amount=request.data.get("amount", 0), currency="usd")
            return Response({"client_secret": intent.client_secret})
        """,
    "backend/store/emails.py": """
        import os

        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail


        def send_receipt(to, total):
            mail = Mail(from_email="orders@shop.example", to_emails=to, subject="Your order", plain_text_content=f"Total: {total}")
            SendGridAPIClient(os.environ.get("SENDGRID_API_KEY")).send(mail)
        """,
    "backend/pytest.ini": "[pytest]\ntestpaths = tests\npythonpath = .\naddopts = -vv\n",
    "backend/tests/test_auth.py": """
        def test_login_needs_email():
            assert "@" in "maker@shop.example"


        def test_password_is_hidden():
            assert "*" * 8 != "secret12"
        """,
    "backend/tests/test_catalog.py": """
        def test_browse_catalog():
            products = [{"name": "Mug", "price": 14.0}, {"name": "Scarf", "price": 29.99}]
            assert [p["name"] for p in products] == ["Mug", "Scarf"]
        """,
    "backend/tests/test_cart.py": """
        from store.pricing import cart_total


        def test_add_to_cart():
            assert cart_total([{"price": 14.0, "quantity": 1}]) == 14.0


        def test_cart_total():
            # Two scarves at 29.99 each.
            assert cart_total([{"price": 29.99, "quantity": 2}]) == 59.98
        """,
    "backend/tests/test_payment.py": """
        def test_checkout_amount_in_cents():
            assert int(round(59.98 * 100)) == 5998
        """,
}


def sh(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


for rel, body in FILES.items():
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(textwrap.dedent(body).lstrip("\n"))

sh("git", "init", "-q", "-b", "main", cwd=root)
sh("git", "config", "user.name", "Maya Builder", cwd=root)
sh("git", "config", "user.email", "maya@shop.example", cwd=root)
sh("git", "add", "-A", cwd=root)
sh("git", "commit", "-q", "-m", "Store: catalog, cart and Stripe checkout", cwd=root)
sh("git", "init", "-q", "--bare", "-b", "main", origin)
sh("git", "remote", "add", "origin", origin, cwd=root)
sh("git", "push", "-q", "-u", "origin", "main", cwd=root)
print(root)
