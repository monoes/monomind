// Stripe node handler — ported from internal/nodes/service/stripe.go
// Operations: list_customers, create_customer, get_customer, list_charges, create_charge,
//             list_subscriptions, create_subscription, cancel_subscription, list_products, create_payment_intent
import type { NodeHandler, Item } from '../engine/index.js';

const STRIPE_BASE = 'https://api.stripe.com/v1';

async function stripeRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  let bodyStr: string | undefined;
  if (body !== undefined && Object.keys(body).length > 0) {
    // Stripe REST uses application/x-www-form-urlencoded
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== null && v !== undefined) params.set(k, String(v));
    }
    bodyStr = params.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const res = await fetch(`${STRIPE_BASE}${path}`, { method, headers, body: bodyStr });
  const text = await res.text();
  if (!res.ok) throw new Error(`stripe HTTP ${res.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function dataToItems(data: Record<string, unknown>): Item[] {
  const list = data['data'] as unknown[] | undefined;
  if (Array.isArray(list)) return list.map(r => ({ data: r as Record<string, unknown> }));
  return [{ data }];
}

const handler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const apiKey = String(config['api_key'] ?? '');
  if (!apiKey) throw new Error('service.stripe: api_key is required');

  const operation = String(config['operation'] ?? 'list_customers');
  const limit = Number(config['limit'] ?? 10);

  switch (operation) {
    case 'list_customers': {
      const data = await stripeRequest('GET', `/customers?limit=${limit}`, apiKey);
      return dataToItems(data);
    }

    case 'create_customer': {
      const body: Record<string, unknown> = {};
      if (config['email']) body['email'] = String(config['email']);
      if (config['name']) body['name'] = String(config['name']);
      if (config['phone']) body['phone'] = String(config['phone']);
      const data = await stripeRequest('POST', '/customers', apiKey, body);
      return [{ data }];
    }

    case 'get_customer': {
      const customerId = String(config['customer_id'] ?? '');
      if (!customerId) throw new Error('service.stripe: customer_id required for get_customer');
      const data = await stripeRequest('GET', `/customers/${customerId}`, apiKey);
      return [{ data }];
    }

    case 'list_charges': {
      let path = `/charges?limit=${limit}`;
      if (config['customer_id']) path += `&customer=${encodeURIComponent(String(config['customer_id']))}`;
      const data = await stripeRequest('GET', path, apiKey);
      return dataToItems(data);
    }

    case 'create_charge': {
      const body: Record<string, unknown> = {
        amount: Number(config['amount'] ?? 0),
        currency: String(config['currency'] ?? 'usd'),
      };
      if (config['customer_id']) body['customer'] = String(config['customer_id']);
      if (config['source']) body['source'] = String(config['source']);
      if (config['description']) body['description'] = String(config['description']);
      const data = await stripeRequest('POST', '/charges', apiKey, body);
      return [{ data }];
    }

    case 'list_subscriptions': {
      let path = `/subscriptions?limit=${limit}`;
      if (config['customer_id']) path += `&customer=${encodeURIComponent(String(config['customer_id']))}`;
      const data = await stripeRequest('GET', path, apiKey);
      return dataToItems(data);
    }

    case 'create_subscription': {
      const customerId = String(config['customer_id'] ?? '');
      const priceId = String(config['price_id'] ?? '');
      if (!customerId) throw new Error('service.stripe: customer_id required for create_subscription');
      if (!priceId) throw new Error('service.stripe: price_id required for create_subscription');
      const data = await stripeRequest('POST', '/subscriptions', apiKey, {
        customer: customerId,
        'items[0][price]': priceId,
      });
      return [{ data }];
    }

    case 'cancel_subscription': {
      const subId = String(config['subscription_id'] ?? '');
      if (!subId) throw new Error('service.stripe: subscription_id required for cancel_subscription');
      const data = await stripeRequest('DELETE', `/subscriptions/${subId}`, apiKey);
      return [{ data }];
    }

    case 'list_products': {
      const data = await stripeRequest('GET', `/products?limit=${limit}`, apiKey);
      return dataToItems(data);
    }

    case 'create_payment_intent': {
      const body: Record<string, unknown> = {
        amount: Number(config['amount'] ?? 0),
        currency: String(config['currency'] ?? 'usd'),
      };
      if (config['customer_id']) body['customer'] = String(config['customer_id']);
      if (config['payment_method_types']) body['payment_method_types[]'] = String(config['payment_method_types']);
      const data = await stripeRequest('POST', '/payment_intents', apiKey, body);
      return [{ data }];
    }

    default:
      throw new Error(`service.stripe: unknown operation "${operation}"`);
  }
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('service.stripe', handler);
}
