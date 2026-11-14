export type EntityDomain = 'location' | 'client' | 'product' | 'generic';

export interface EntityLabels {
  singular: string;
  plural: string;
  singularCap: string;
  pluralCap: string;
  domain: EntityDomain;
}

const KNOWN_IRREGULAR_PLURALS: Record<string, string> = {
  pais: 'países',
  país: 'países',
  region: 'regiones',
  región: 'regiones',
  sucursal: 'sucursales',
  ciudad: 'ciudades',
  almacen: 'almacenes',
  almacén: 'almacenes',
  cliente: 'clientes',
  tienda: 'tiendas',
  producto: 'productos',
  registro: 'registros',
  mercado: 'mercados',
  plaza: 'plazas',
  mes: 'meses',
  item: 'ítems',
  ítem: 'ítems',
};

function stripAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function capitalizeWord(word: string): string {
  const s = word.trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pluralizeSpanishNoun(singularRaw: string): string {
  const clean = singularRaw.trim().toLowerCase();
  if (!clean) return 'registros';

  // Multi-word noun with "de" (e.g. "punto de venta" -> "puntos de venta")
  const deIdx = clean.indexOf(' de ');
  if (deIdx > 0) {
    const head = clean.slice(0, deIdx);
    const tail = clean.slice(deIdx);
    return `${pluralizeSpanishNoun(head)}${tail}`;
  }

  // Multi-word noun without "de": pluralize each word cleanly unless second is short prep
  if (clean.includes(' ')) {
    return clean
      .split(/\s+/)
      .map((part) => pluralizeSpanishNoun(part))
      .join(' ');
  }

  const noAcc = stripAccents(clean);
  if (KNOWN_IRREGULAR_PLURALS[clean]) return KNOWN_IRREGULAR_PLURALS[clean];
  if (KNOWN_IRREGULAR_PLURALS[noAcc]) return KNOWN_IRREGULAR_PLURALS[noAcc];

  // Already looks plural (ends in s and length > 3, not país/mes/lunes-like already handled)
  if (clean.endsWith('s') && clean.length > 3 && !clean.endsWith('ís')) {
    return clean;
  }

  if (clean.endsWith('z')) {
    return `${clean.slice(0, -1)}ces`;
  }

  // Trailing stressed syllable accent on -ón, -án, -én, -ín, -és -> drop accent + es
  if (/([áéíóú])([ns])$/.test(clean)) {
    const base = stripAccents(clean.slice(0, -1)) + clean.slice(-1);
    return `${base}es`;
  }

  if (/[aeiouáéó]$/.test(clean)) {
    return `${clean}s`;
  }

  if (/[íú]$/.test(clean)) {
    return `${clean}es`;
  }

  if (/[lrndjx]$/.test(clean)) {
    return `${clean}es`;
  }

  return `${clean}s`;
}

export function suggestEntitySingular(
  identifierCol: string | null,
  allColumns: string[] = []
): string {
  const candidates = identifierCol ? [identifierCol, ...allColumns] : allColumns;

  for (const col of candidates) {
    const low = stripAccents(col.toLowerCase());
    if (/(country|pais|nation|nacion)/.test(low)) return 'país';
    if (/(tienda|store|shop|pdv|punto_venta)/.test(low)) return 'tienda';
    if (/(sucursal|branch|agencia|oficina|sede|local)/.test(low)) return 'sucursal';
    if (/(cliente|customer|client|comprador)/.test(low)) return 'cliente';
    if (/(producto|product|sku|articulo|referencia)/.test(low)) return 'producto';
    if (/(ciudad|city|municipio|localidad)/.test(low)) return 'ciudad';
    if (/(region|zona|area|territorio)/.test(low)) return 'región';
    if (/(mercado|market|plaza)/.test(low)) return 'mercado';
    if (/(usuario|user|suscriptor|cuenta|account)/.test(low)) return 'usuario';
    if (/(vendedor|asesor|ejecutivo)/.test(low)) return 'vendedor';
    if (/(empleado|colaborador|trabajador)/.test(low)) return 'empleado';
    if (/(paciente|patient)/.test(low)) return 'paciente';
    if (/(empresa|company|compania|proveedor|supplier)/.test(low)) return 'empresa';
    if (/(pedido|orden|order|factura|transaccion|venta)/.test(low) && col === identifierCol) {
      return 'operación';
    }
  }

  if (identifierCol) {
    const cleaned = stripAccents(identifierCol.toLowerCase())
      .replace(/^(id_|cod_|codigo_|num_|nro_|key_)/, '')
      .replace(/(_id|_cod|_codigo|_num|_key)$/, '')
      .replace(/_/g, ' ')
      .trim();
    if (cleaned && cleaned !== 'id' && cleaned !== 'codigo' && cleaned !== 'cod' && cleaned.length >= 3) {
      return cleaned;
    }
  }

  return 'registro';
}

export function classifyEntityDomain(singularRaw: string): EntityDomain {
  const low = stripAccents(singularRaw.trim().toLowerCase());
  if (!low) return 'generic';

  if (
    /^(pais|ciudad|region|tienda|sucursal|sede|zona|mercado|plaza|estado|provincia|municipio|departamento|comuna|distrito|local|punto de venta|pdv|almacen|bodega|agencia|oficina|territorio|sector|barrio|ubicacion|lugares?)/.test(
      low
    )
  ) {
    return 'location';
  }

  if (
    /^(cliente|usuario|cuenta|comprador|consumidor|suscriptor|afiliado|socio|miembro|lead|prospecto|empresa|paciente|huesped|alumno|estudiante)/.test(
      low
    )
  ) {
    return 'client';
  }

  if (
    /^(producto|sku|articulo|item|referencia|marca|linea|servicio|plan|categoria|modelo)/.test(
      low
    )
  ) {
    return 'product';
  }

  return 'generic';
}

export function buildEntityLabels(singularInput: string): EntityLabels {
  const singular = singularInput.trim().toLowerCase() || 'registro';
  const plural = pluralizeSpanishNoun(singular);
  return {
    singular,
    plural,
    singularCap: capitalizeWord(singular),
    pluralCap: capitalizeWord(plural),
    domain: classifyEntityDomain(singular),
  };
}
