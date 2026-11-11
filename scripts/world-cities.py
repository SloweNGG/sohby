# Dünya şehirleri listesini (GeoNames, CC BY 4.0) migration dosyasına çevirir.
#
#   curl -LO https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
#   curl -LO https://download.geonames.org/export/dump/admin1CodesASCII.txt
#   python3 scripts/world-cities.py <indirilen klasör> \
#     supabase/migrations/<yeni>_world_cities_data.sql src/lib/data/countries.ts /tmp/foldmap.json
#   node scripts/country-names.mjs
#
# Türkiye hariç tutulur (81 il listesi kullanılır); koordinat alınmaz (kural 12).
# Arama sadeleştirmesi (aksan kaldırma) private.geo_fold ile birebir aynı olmalı:
# foldmap.json'daki from/to dizeleri o fonksiyona yazılır.
import sys, unicodedata, re, json
geo, out_sql, out_ts, out_map = sys.argv[1:5]

SPECIAL = {"ı":"i","İ":"i","ł":"l","Ł":"l","ø":"o","Ø":"o","đ":"d","Đ":"d","ħ":"h","Ħ":"h","ß":"s","ẞ":"s",
           "æ":"a","Æ":"a","œ":"o","Œ":"o","þ":"t","Þ":"t","ð":"d","Ð":"d","ŋ":"n","Ŋ":"n","ŧ":"t","Ŧ":"t",
           "ƒ":"f","ǝ":"e","ə":"e","Ə":"e","ŀ":"l","Ŀ":"l","ĸ":"k"}
DELETE = "'’ʻʼ`.‘"
fmap = {}
ranges = list(range(0xC0, 0x250)) + list(range(0x1E00, 0x1F00))
for cp in ranges:
    c = chr(cp)
    if c in SPECIAL: fmap[c] = SPECIAL[c]; continue
    base = "".join(ch for ch in unicodedata.normalize("NFKD", c) if ch.isascii() and ch.isalpha())
    if len(base) == 1: fmap[c] = base.lower()
for c, b in SPECIAL.items(): fmap[c] = b
fmap["-"] = " "
src = "".join(fmap.keys()); dst = "".join(fmap.values())
json.dump({"from": src + DELETE, "to": dst}, open(out_map, "w", encoding="utf-8"), ensure_ascii=False)

def fold(s):
    s = "".join(fmap.get(ch, "" if ch in DELETE else ch) for ch in s)
    return "".join(ch.lower() if ch.isascii() else ch for ch in s).strip()

admin1 = {}
for line in open(f"{geo}/admin1CodesASCII.txt", encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    admin1[f[0]] = f[1]

latin = re.compile(r"^[A-Za-zÀ-ɏḀ-ỿ' .\-’ʻʼ]+$")
rows = []; countries = set()
for line in open(f"{geo}/cities15000.txt", encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    gid, name, ascii_name, alts, cc, a1, pop = f[0], f[1], f[2], f[3], f[8], f[10], f[14]
    if cc == "TR" or len(name) > 60: continue
    countries.add(cc)
    names = [fold(name), fold(ascii_name)]
    for a in alts.split(","):
        a = a.strip()
        if not a or len(a) > 40 or not latin.match(a): continue
        fa = fold(a)
        if fa and fa.isascii(): names.append(fa)
    seen = []
    for n in names:
        if n and n not in seen: seen.append(n)
    region = admin1.get(f"{cc}.{a1}")
    if region == name: region = None
    rows.append((int(gid), cc, name, region, int(pop or 0), "|" + "|".join(seen) + "|"))

def q(s): return "null" if s is None else "'" + s.replace("'", "''") + "'"
with open(out_sql, "w", encoding="utf-8") as o:
    o.write("-- Dünya şehirleri (Türkiye hariç; Türkiye 81 il listesiyle seçilir).\n")
    o.write("-- Kaynak: GeoNames cities15000 (nüfusu 15.000 üzeri), https://www.geonames.org, CC BY 4.0.\n")
    o.write("-- Koordinat bilerek alınmadı. Bu dosya scripts/world-cities.py ile üretildi; elle düzenleme.\n\n")
    for i in range(0, len(rows), 1000):
        chunk = rows[i:i+1000]
        o.write("insert into public.world_cities (id, country_code, name, region, inhabitants, search) values\n")
        o.write(",\n".join(f"({r[0]},'{r[1]}',{q(r[2])},{q(r[3])},{r[4]},{q(r[5])})" for r in chunk))
        o.write(";\n\n")
with open(out_ts, "w", encoding="utf-8") as o:
    o.write("// scripts/world-cities.py ile üretildi; elle düzenleme.\n")
    o.write("/** Şehir listesinde en az bir şehri olan ülkelerin ISO kodları (Türkiye dahil). */\n")
    codes = sorted(countries | {"TR"})
    o.write("export const COUNTRY_CODES = [\n")
    for i in range(0, len(codes), 16):
        o.write("  " + ", ".join(f'"{c}"' for c in codes[i:i+16]) + ",\n")
    o.write("] as const;\n\nexport type CountryCode = (typeof COUNTRY_CODES)[number];\n")
print(len(rows), len(countries))
