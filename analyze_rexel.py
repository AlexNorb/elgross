
def find_indices():
    with open('rexel_gnp.txt', 'r', encoding='latin-1') as f: # standard swedish encoding likely
        line = f.readline()
        # skip header if exists, reading a few lines
        lines = [f.readline() for _ in range(5)]
    
    # We know from previous head:
    # 0001080... 00NSU... 241,00
    
    print("--- RAW LINES ---")
    for l in lines:
        print(repr(l))

    print("\n--- SPLIT BY SEMICOLON ---")
    for l in lines:
        parts = l.strip().split(';')
        print(f"Parts count: {len(parts)}")
        for i, p in enumerate(parts):
            print(f"{i}: {p}")
            if "00NSU" in p:
                print(f"FOUND DISCOUNT 00NSU AT INDEX {i}")
            if "241,00" in p:
                print(f"FOUND PRICE 241,00 AT INDEX {i}")

find_indices()
