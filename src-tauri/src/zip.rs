// Minimal ZIP reader/writer (stored entries, no compression).
// Enough for .bloom bundles: manifest.json, board.json, attachments/*.

pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn put_u16(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

pub fn write_zip(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();

    for (name, data) in entries {
        let offset = out.len() as u32;
        let crc = crc32(data);
        put_u32(&mut out, 0x0403_4b50);
        put_u16(&mut out, 20);
        put_u16(&mut out, 0);
        put_u16(&mut out, 0); // stored
        put_u16(&mut out, 0);
        put_u16(&mut out, 0);
        put_u32(&mut out, crc);
        put_u32(&mut out, data.len() as u32);
        put_u32(&mut out, data.len() as u32);
        put_u16(&mut out, name.len() as u16);
        put_u16(&mut out, 0);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);

        put_u32(&mut central, 0x0201_4b50);
        put_u16(&mut central, 20);
        put_u16(&mut central, 20);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u32(&mut central, crc);
        put_u32(&mut central, data.len() as u32);
        put_u32(&mut central, data.len() as u32);
        put_u16(&mut central, name.len() as u16);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u32(&mut central, 0);
        put_u32(&mut central, offset);
        central.extend_from_slice(name.as_bytes());
    }

    let cd_offset = out.len() as u32;
    out.extend_from_slice(&central);
    put_u32(&mut out, 0x0605_4b50);
    put_u16(&mut out, 0);
    put_u16(&mut out, 0);
    put_u16(&mut out, entries.len() as u16);
    put_u16(&mut out, entries.len() as u16);
    put_u32(&mut out, central.len() as u32);
    put_u32(&mut out, cd_offset);
    put_u16(&mut out, 0);
    out
}

fn u16_at(d: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([d[i], d[i + 1]])
}

fn u32_at(d: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([d[i], d[i + 1], d[i + 2], d[i + 3]])
}

/// Read a stored zip. Rejects traversal, compression and absurd sizes.
pub fn read_zip(data: &[u8], max_total: u64) -> Result<Vec<(String, Vec<u8>)>, String> {
    if data.len() < 22 {
        return Err("file is too small to be a .bloom bundle".into());
    }
    let search_from = data.len().saturating_sub(66_000);
    let mut eocd = None;
    for i in (search_from..data.len().saturating_sub(21)).rev() {
        if u32_at(data, i) == 0x0605_4b50 {
            eocd = Some(i);
            break;
        }
    }
    let eocd = eocd.ok_or("not a zip archive")?;
    let count = u16_at(data, eocd + 10) as usize;
    let cd_size = u32_at(data, eocd + 12) as usize;
    let cd_offset = u32_at(data, eocd + 16) as usize;
    if cd_offset + cd_size > data.len() {
        return Err("corrupt central directory".into());
    }

    let mut entries = Vec::new();
    let mut total: u64 = 0;
    let mut p = cd_offset;
    for _ in 0..count {
        if p + 46 > data.len() || u32_at(data, p) != 0x0201_4b50 {
            return Err("corrupt zip entry".into());
        }
        let method = u16_at(data, p + 10);
        let comp = u32_at(data, p + 20) as usize;
        let uncomp = u32_at(data, p + 24) as usize;
        let name_len = u16_at(data, p + 28) as usize;
        let extra_len = u16_at(data, p + 30) as usize;
        let comment_len = u16_at(data, p + 32) as usize;
        let local = u32_at(data, p + 42) as usize;
        let name = String::from_utf8_lossy(&data[p + 46..p + 46 + name_len]).into_owned();
        p += 46 + name_len + extra_len + comment_len;

        if name.contains("..") || name.starts_with('/') || name.contains('\\') {
            return Err(format!("refusing unsafe path in bundle: {name}"));
        }
        if method != 0 {
            return Err(format!("unsupported compression in bundle entry {name}"));
        }
        total += uncomp as u64;
        if total > max_total {
            return Err("bundle is larger than the 500 MB limit".into());
        }
        if local + 30 > data.len() || u32_at(data, local) != 0x0403_4b50 {
            return Err("corrupt local header".into());
        }
        let l_name = u16_at(data, local + 26) as usize;
        let l_extra = u16_at(data, local + 28) as usize;
        let start = local + 30 + l_name + l_extra;
        if start + comp > data.len() {
            return Err("truncated entry".into());
        }
        entries.push((name, data[start..start + comp].to_vec()));
    }
    Ok(entries)
}
