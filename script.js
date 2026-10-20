(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toLocaleString("id-ID");
  const norm = (s) =>
    String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  let accounts = [],
    winners = [],
    candidate = null,
    spinning = false,
    timer = null,
    spinAudio = null,
    soundOn = true,
    spinTrack = null,
    effectTracks = [],
    tickets = [],
    currentSpinTicket = null,
    musicStartedAt = 0;
  const defaultPrizes = [
    "KOMPOR GAS",
    "MAGIC COM",
    "KIPAS ANGIN",
    "MESIN CUCI",
    'TELEVISI LED 43"',
  ];
  const prizeAssets = {
    'TELEVISI LED 43"': "televisi.png",
    "MESIN CUCI": "mesin-cuci.png",
    "MAGIC COM": "rice-cooker.png",
    "KIPAS ANGIN": "kipas-angin.png",
    "KOMPOR GAS": "kompor-gas.png",
  };
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 3200);
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function money(v) {
    if (typeof v === "number") return v;
    let s = String(v ?? "")
      .trim()
      .replace(/\s/g, "")
      .replace(/rp/gi, "");
    if (!s) return 0;
    if (s.includes(".") && s.includes(","))
      s = s.replace(/\./g, "").replace(",", ".");
    else if (s.includes(",")) s = s.replace(",", ".");
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
    else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
    return Math.max(0, Number(s.replace(/[^\d.-]/g, "")) || 0);
  }
  function val(row, keys) {
    const es = Object.entries(row);
    for (const k of keys) {
      const hit = es.find(([a]) => norm(a) === norm(k));
      if (hit && String(hit[1] ?? "").trim() !== "")
        return String(hit[1]).trim();
    }
    return "";
  }
  // Format peserta: NO_URUT, NO_KUPON, NAMA_PESERTA. Setiap baris = satu kupon.
  function parseRows(rows) {
    const seen = new Set();
    return rows.map((r, i) => {
      const noUrut = val(r, ["NO_URUT", "NOURUT", "NO URUT", "NOMOR_URUT", "NO"]);
      const noKupon = val(r, ["NO_KUPON", "NOKUPON", "NO KUPON", "NOMOR_KUPON", "NOMOR KUPON", "KUPON"]);
      const nama = val(r, ["NAMA_PESERTA", "NAMAPESERTA", "NAMA PESERTA", "NAMA", "NAMA_NASABAH"]);
      const coupon = String(noKupon || "").trim();
      if (!coupon || !nama) return null;
      const key = coupon.toLocaleUpperCase();
      if (seen.has(key)) throw Error(`Nomor kupon duplikat: ${coupon}. Pastikan setiap NO_KUPON unik.`);
      seen.add(key);
      return {
        id: i + 1,
        noUrut: String(noUrut || i + 1).trim(),
        noKupon: coupon,
        rekening: coupon, // kompatibilitas data lama; identitas undian sekarang berdasarkan kupon
        nama: String(nama).trim(),
        saldo: 0, alamat: "", kantor: "-", kode: "",
        status: "TERSEDIA", peluang: 1,
        ticketStart: i + 1, ticketEnd: i + 1,
      };
    }).filter(Boolean);
  }
  function calcTickets() {
    tickets = accounts.map((a, i) => ({
      number: i + 1,
      nomor: String(a.noKupon ?? a.rekening ?? i + 1),
      accountId: a.id,
      rekening: String(a.noKupon ?? a.rekening ?? ""),
    }));
  }
  function eligibleAccounts() {
    return accounts.filter(a => a.status !== "MENANG" &&
      !winners.some(w => String(w.noKupon ?? w.rekening ?? w.nomor) === String(a.noKupon ?? a.rekening)));
  }
  function availableTickets() {
    const ids = new Set(eligibleAccounts().map(a => a.id));
    return tickets.filter(t => ids.has(t.accountId));
  }
  function updateStats() {
    const e = eligibleAccounts(),
      av = availableTickets();
    $("totalPeserta").textContent = fmt(
      accounts.length,
    );
    $("totalKupon").textContent = fmt(tickets.length);
    $("totalMenang").textContent = fmt(winners.length);
    $("totalSisa").textContent = fmt(e.length);
    if ($("totalTiketTersisa"))
      $("totalTiketTersisa").textContent = fmt(av.length);
    syncButtons();
  }
  function syncButtons() {
    const can = availableTickets().length > 0;
    const next = $("btnUndianBerikutnya");
    if (next) {
      next.hidden = winners.length === 0;
      next.disabled = spinning || !can;
      next.textContent = can
        ? "▶ MULAI UNDIAN BERIKUTNYA"
        : "✓ SEMUA NOMOR TELAH DIUNDI";
    }
    $("btnMulai").disabled = spinning || !can;
    $("btnStop").disabled = !spinning;
    $("btnSah").disabled = spinning || !candidate;
    $("btnResetKandidat").disabled = spinning || !candidate;
    ["btnMulaiFS", "btnStopFS", "btnSahFS", "btnResetKandidatFS"].forEach(
      (id, i) => {
        const b = $(id);
        if (b)
          b.disabled = [
            spinning || !can,
            !spinning,
            spinning || !candidate,
            spinning || !candidate,
          ][i];
      },
    );
  }
  function displayBlank(text = "SIAP MEMULAI PENGUNDIAN") {
    $("nomorKupon").textContent = "SIAP";
    $("namaPemenang").textContent = text;
    $("alamatPemenang").textContent = "";
    $("kantorPemenang").textContent = "";
    $("detailPemenang").textContent =
      "Informasi peserta tampil setelah tombol STOP ditekan.";
  }
  function displayReady() {
    if (spinning || candidate) return;
    $("nomorKupon").textContent = "SIAP UNDI";
    $("namaPemenang").textContent = "HADIAH SIAP DIUNDI";
    $("alamatPemenang").textContent =
      "Silakan tekan tombol MULAI untuk mengacak nomor";
    $("kantorPemenang").textContent = "";
    $("detailPemenang").textContent =
      "Hadiah terpilih: " + $("pilihanHadiah").value;
    $("winnerBanner").classList.add("hidden");
  }
  function displaySpinning(t) {
    $("nomorKupon").textContent = t.nomor;
    $("namaPemenang").textContent = "";
    $("alamatPemenang").textContent = "";
    $("kantorPemenang").textContent = "";
    $("detailPemenang").textContent = "";
    $("winnerBanner").classList.add("hidden");
  }
  function maskAccount(v) {
    const raw = String(v ?? "").trim(),
      digits = raw.replace(/\D/g, "");
    if (digits.length < 5) return raw ? raw.replace(/.(?=.{3})/g, "x") : "-";
    return `${digits.slice(0, 2)}.XXX.XX${digits.slice(-4)}`;
  }
  function displayCandidate(t, a) {
    $("nomorKupon").textContent = t.nomor;
    $("detailPemenang").textContent = "NAMA PESERTA";
    $("namaPemenang").textContent = a.nama || "-";
    $("alamatPemenang").textContent = "";
    $("kantorPemenang").textContent = "";
  }
  function renderWinners() {
    $("daftarPemenang").innerHTML = winners.length
      ? winners.map((w, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(w.noKupon ?? w.nomor ?? "-")}</td><td>${escapeHtml(w.hadiah)}</td><td>${escapeHtml(w.nama)}</td><td>${escapeHtml(w.waktu)}</td></tr>`
        ).join("")
      : '<tr><td colspan="5" class="empty-state">Belum ada pemenang.</td></tr>';
    updateStats();
    persistState();
  }
  function persistState() {
    try {
      localStorage.setItem(
        "spektamades_coupon_state_v4",
        JSON.stringify({
          accounts,
          winners,
          interval: $("interval").value,
          hadiah: $("pilihanHadiah").value,
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch (e) {
      toast("Penyimpanan browser penuh. Silakan gunakan SIMPAN BACKUP.");
    }
  }
  function restoreState() {
    try {
      const raw = localStorage.getItem("spektamades_coupon_state_v4");
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!Array.isArray(d.accounts) || !Array.isArray(d.winners)) return false;
      accounts = d.accounts;
      winners = d.winners;
      $("interval").value = d.interval ?? 75;
      calcTickets();
      renderWinners();
      displayBlank();
      if (
        d.hadiah &&
        [...$("pilihanHadiah").options].some((o) => o.value === d.hadiah)
      )
        $("pilihanHadiah").value = d.hadiah;
      updatePrize();
      $("statusImport").textContent =
        `Data dipulihkan otomatis: ${fmt(accounts.length)} kupon, ${fmt(winners.length)} pemenang.`;
      return true;
    } catch (e) {
      return false;
    }
  }
  // AUDIO LOKAL: seluruh suara dapat diganti cukup dengan mengganti file di folder assets.
  const audioAssets = {
    roll: "./assets/drum-roll.wav",
    stop: "./assets/drum-stop.wav",
    winner: "./assets/winner-fanfare.wav",
    cancel: "./assets/cancel-candidate.wav",
  };
  function playEffect(key) {
    if (!soundOn) return;
    try {
      const a = new Audio(audioAssets[key]);
      a.preload = "auto";
      a.volume = key === "winner" ? 0.95 : 0.85;
      effectTracks = effectTracks.filter((x) => !x.ended);
      effectTracks.push(a);
      const p = a.play();
      if (p && p.catch) p.catch((e) => console.warn("Audio effect:", e));
    } catch (e) {
      console.warn("Audio tidak tersedia:", e);
    }
  }
  function startMusic() {
    if (!soundOn) return;
    stopMusic();
    try {
      spinTrack = new Audio(audioAssets.roll);
      spinTrack.loop = true;
      spinTrack.preload = "auto";
      spinTrack.volume = 0.48;
      spinTrack.playbackRate = 1;
      const p = spinTrack.play();
      if (p && p.catch) p.catch((e) => console.warn("Musik drum roll:", e));
      musicStartedAt = Date.now();
      // Intensitas meningkat perlahan: volume dan kecepatan roll bertambah mendekati akhir.
      spinAudio = setInterval(() => {
        if (!spinning || !soundOn || !spinTrack) return;
        const elapsed = (Date.now() - musicStartedAt) / 1000;
        spinTrack.playbackRate = Math.min(1.65, 1 + elapsed * 0.035);
        spinTrack.volume = Math.min(0.88, 0.48 + elapsed * 0.035);
      }, 350);
    } catch (e) {
      console.warn("Musik drum roll tidak tersedia:", e);
    }
  }
  function stopMusic() {
    if (spinAudio) {
      clearInterval(spinAudio);
      spinAudio = null;
    }
    if (spinTrack) {
      spinTrack.pause();
      try {
        spinTrack.currentTime = 0;
      } catch (e) {}
      spinTrack = null;
    }
  }
  function stopCue() {
    playEffect("stop");
  }
  function winCue() {
    playEffect("winner");
  }
  function cancelCue() {
    playEffect("cancel");
  }
  function startDraw() {
    if (spinning) return;
    calcTickets();
    const pool = availableTickets();
    if (!pool.length) {
      toast(
        "Tidak ada nomor kupon tersisa. Impor template peserta atau periksa kupon yang tersedia.",
      );
      return;
    }
    candidate = null;
    currentSpinTicket = null;
    $("winnerBanner").classList.add("hidden");
    spinning = true;
    syncButtons();
    $("statusImport").textContent =
      `Pengundian berlangsung dari ${fmt(pool.length)} nomor kupon. Nama peserta tampil setelah STOP.`;
    if (soundOn) {
      try {
        startMusic();
      } catch (e) {
        console.warn("Audio tidak tersedia di browser ini:", e);
        toast(
          "Audio tidak tersedia. Periksa folder assets. Pengundian tetap berjalan.",
        );
      }
    }
    timer = setInterval(
      () => {
        const p = availableTickets();
        if (!p.length) {
          stopDraw();
          return;
        }
        currentSpinTicket = p[Math.floor(Math.random() * p.length)];
        displaySpinning(currentSpinTicket);
      },
      Math.max(35, Number($("interval").value) || 75),
    );
  }
  function stopDraw() {
    if (!spinning) return;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    spinning = false;
    stopMusic();
    const pool = availableTickets();
    if (!pool.length) {
      currentSpinTicket = null;
      candidate = null;
      displayBlank("NOMOR KUPON HABIS");
      syncButtons();
      toast("Tidak ada nomor kupon tersisa.");
      return;
    }
    let t = currentSpinTicket;
    if (!t || !pool.some((x) => x.number === t.number))
      t = pool[Math.floor(Math.random() * pool.length)];
    const a = accounts.find((x) => x.id === t.accountId);
    if (!a || a.status === "MENANG") {
      currentSpinTicket = null;
      candidate = null;
      displayBlank("SILAKAN ULANGI PENGUNDIAN");
      syncButtons();
      toast("Nomor tidak lagi tersedia. Silakan mulai kembali.");
      return;
    }
    candidate = { ticket: t, account: a };
    displayCandidate(t, a);
    $("winnerBanner").classList.add("hidden");
    $("statusImport").textContent =
      "Kandidat kupon terpilih. Tekan SAH untuk mengesahkan atau BATALKAN KANDIDAT untuk mengundi ulang.";
    stopCue();
    syncButtons();
  }
  function confirmWinner() {
    if (!candidate || spinning) return;
    const a = candidate.account,
      t = candidate.ticket;
    if (
      winners.some((w) => String(w.noKupon ?? w.nomor ?? w.rekening) === String(t.nomor)) ||
      !accounts.some((x) => x.id === a.id && x.status !== "MENANG")
    ) {
      candidate = null;
      currentSpinTicket = null;
      displayBlank("KUPON SUDAH MENANG");
      syncButtons();
      toast("Kupon ini sudah menang. Silakan undi kembali.");
      return;
    }
    const original = accounts.find((x) => x.id === a.id);
    const w = {
      ...original,
      nomor: t.nomor,
      nomorUndian: t.nomor,
      noKupon: t.nomor,
      hadiah: $("pilihanHadiah").value,
      waktu: new Date().toLocaleString("id-ID"),
      status: "MENANG",
    };
    winners.push(w);
    original.status = "MENANG";
    $("winnerBanner").classList.remove("hidden");
    $("pemenangResmi").textContent = `NO. KUPON ${w.noKupon} — ${w.nama} | ${w.hadiah}`;
    $("statusImport").textContent =
      `Pemenang sah: kupon ${w.noKupon} — ${w.nama} — ${w.hadiah}`;
    candidate = null;
    currentSpinTicket = null;
    winCue();
    renderWinners();
    persistState();
    syncButtons();
  }
  function cancelCandidate() {
    if (!candidate) return;
    candidate = null;
    currentSpinTicket = null;
    displayBlank("KANDIDAT DIBATALKAN");
    $("statusImport").textContent =
      "Kandidat dibatalkan. Nomor tersebut kembali tersedia untuk pengundian.";
    cancelCue();
    persistState();
    syncButtons();
  }
  function syncPrizeSelects() {
    const old = $("pilihanHadiah").value;
    let custom = [];
    try {
      custom = JSON.parse(localStorage.getItem("undian_custom_prizes") || "[]");
    } catch (e) {}
    const prizes = [...new Set([...defaultPrizes, ...custom])];
    for (const id of ["pilihanHadiah", "pilihanHadiahFS"]) {
      const s = $(id),
        prev = s.value;
      s.innerHTML = prizes
        .map(
          (p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`,
        )
        .join("");
      s.value = prizes.includes(prev)
        ? prev
        : prizes.includes(old)
          ? old
          : prizes[0];
    }
    updatePrize();
  }
  function updatePrize() {
    const p = $("pilihanHadiah").value;
    $("pilihanHadiahFS").value = p;
    $("judulHadiah").textContent = p;
    $("giftLabel").textContent = p;
    const asset = prizeAssets[p];
    if (asset) {
      $("gambarHadiah").src = "./assets/" + asset;
      $("gambarHadiah").style.display = "block";
      $("placeholderHadiah").style.display = "none";
      $("gambarHadiah").onerror = () => {
        $("gambarHadiah").style.display = "none";
        $("placeholderHadiah").style.display = "flex";
      };
    } else {
      $("gambarHadiah").removeAttribute("src");
      $("gambarHadiah").style.display = "none";
      $("placeholderHadiah").style.display = "flex";
    }
    if (!spinning && !candidate) {
      displayReady();
      $("statusImport").textContent =
        "Hadiah " +
        p +
        " dipilih. Tampilan SIAP UNDI; tekan MULAI untuk memulai pengundian.";
    }
  }
  function downloadXlsx(filename, sheetName, rows) {
    if (!window.XLSX) {
      toast(
        "Excel library belum termuat. Pastikan internet aktif, lalu coba lagi.",
      );
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows),
      wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
  }
  function exportWinners() {
    if (!winners.length) { toast("Belum ada pemenang untuk diekspor."); return; }
    downloadXlsx("Daftar_Pemenang_Spektamades_2026.xlsx", "Pemenang", winners.map((w, i) => ({
      NO_URUT: i + 1, NO_KUPON: w.noKupon ?? w.nomor, NAMA_PESERTA: w.nama,
      HADIAH: w.hadiah, WAKTU: w.waktu,
    })));
  }
  function downloadNumbers() {
    if (!accounts.length) { toast("Impor data peserta terlebih dahulu."); return; }
    downloadXlsx("Daftar_Kupon_Spektamades_2026.xlsx", "Daftar Kupon", accounts.map((a, i) => ({
      NO_URUT: a.noUrut || i + 1, NO_KUPON: a.noKupon ?? a.rekening, NAMA_PESERTA: a.nama,
      STATUS: a.status === "MENANG" ? "SUDAH MENANG" : "TERSEDIA",
    })));
  }
  function downloadTemplate() {
    downloadXlsx("Template_Peserta_Undian_Spektamades_2026.xlsx", "Peserta", [
      { NO_URUT: 1, NO_KUPON: "000001", NAMA_PESERTA: "CONTOH NAMA PESERTA" },
      { NO_URUT: 2, NO_KUPON: "000002", NAMA_PESERTA: "CONTOH PESERTA KEDUA" },
    ]);
  }
  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i].map(v => norm(v));
      if (r.includes("nokupon") && (r.includes("namapeserta") || r.includes("nama"))) return i;
    }
    return 0;
  }
  $("fileExcel").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (!window.XLSX)
        throw Error("Pustaka Excel belum termuat. Pastikan internet aktif.");
      const buf = await file.arrayBuffer(),
        wb = XLSX.read(buf, { type: "array", raw: false }),
        sheet = wb.Sheets[wb.SheetNames[0]],
        raw = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
          raw: false,
        }),
        h = findHeader(raw),
        headers = (raw[h] || []).map((v) => String(v ?? "").trim()),
        rows = raw
          .slice(h + 1)
          .filter((r) => r.some((v) => String(v ?? "").trim()))
          .map((r) =>
            Object.fromEntries(
              headers.map((head, i) => [head || `KOLOM_${i + 1}`, r[i] ?? ""]),
            ),
          );
      if (!rows.length)
        throw Error("Baris peserta tidak ditemukan. Periksa header NO_URUT, NO_KUPON, NAMA_PESERTA.");
      accounts = parseRows(rows);
      if (!accounts.length)
        throw Error("Data tidak valid. Pastikan setiap baris berisi NO_KUPON dan NAMA_PESERTA.");
      winners = [];
      candidate = null;
      calcTickets();
      renderWinners();
      displayBlank();
      $("statusImport").textContent =
        `Berhasil mengimpor ${fmt(accounts.length)} kupon dari ${file.name}. Pengundian dilakukan langsung berdasarkan NO_KUPON.`;
      persistState();
      toast("Data kupon peserta berhasil diimpor.");
    } catch (err) {
      $("statusImport").textContent = "Gagal impor: " + err.message;
      toast(err.message);
    }
  });
  $("btnMulai").addEventListener("click", startDraw);
  $("btnMulaiFS").addEventListener("click", startDraw);
  $("btnUndianBerikutnya").addEventListener("click", () => {
    if (winners.length === 0) {
      toast("Tetapkan pemenang pertama terlebih dahulu.");
      return;
    }
    startDraw();
  });
  $("btnStop").addEventListener("click", stopDraw);
  $("btnStopFS").addEventListener("click", stopDraw);
  $("btnSah").addEventListener("click", confirmWinner);
  $("btnSahFS").addEventListener("click", confirmWinner);
  $("btnResetKandidat").addEventListener("click", cancelCandidate);
  $("btnResetKandidatFS").addEventListener("click", cancelCandidate);
  $("pilihanHadiah").addEventListener("change", updatePrize);
  $("pilihanHadiahFS").addEventListener("change", () => {
    $("pilihanHadiah").value = $("pilihanHadiahFS").value;
    updatePrize();
    persistState();
  });
  $("interval").addEventListener("change", persistState);
  $("btnTambahHadiah").addEventListener("click", () => {
    const name = $("namaHadiah").value.trim().toUpperCase();
    if (!name) {
      toast("Masukkan nama hadiah terlebih dahulu.");
      return;
    }
    let p = [];
    try {
      p = JSON.parse(localStorage.getItem("undian_custom_prizes") || "[]");
    } catch (e) {}
    if (!p.includes(name) && !defaultPrizes.includes(name)) p.push(name);
    localStorage.setItem("undian_custom_prizes", JSON.stringify(p));
    syncPrizeSelects();
    $("pilihanHadiah").value = name;
    updatePrize();
    $("namaHadiah").value = "";
    toast("Hadiah berhasil ditambahkan.");
  });
  $("btnDownloadNomor").addEventListener("click", downloadNumbers);
  if ($("btnTemplate")) $("btnTemplate").addEventListener("click", downloadTemplate);
  $("btnExport").addEventListener("click", exportWinners);
  $("btnBackup").addEventListener("click", () => {
    const data = {
      version: 3,
      createdAt: new Date().toISOString(),
      accounts,
      winners,
      prizes: JSON.parse(localStorage.getItem("undian_custom_prizes") || "[]"),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "Backup_Undian_Spektamades_2026.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("File backup berhasil dibuat.");
  });
  $("fileBackup").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.accounts) || !Array.isArray(d.winners))
        throw Error("Format backup tidak sesuai.");
      if (
        !confirm(
          "Pulihkan backup? Data peserta dan pemenang yang sedang terbuka akan diganti.",
        )
      )
        return;
      accounts = d.accounts;
      winners = d.winners;
      candidate = null;
      spinning = false;
      stopMusic();
      if (timer) clearInterval(timer);
      timer = null;
      localStorage.setItem(
        "undian_custom_prizes",
        JSON.stringify(d.prizes || []),
      );
      syncPrizeSelects();
      calcTickets();
      renderWinners();
      displayBlank();
      persistState();
      $("statusImport").textContent =
        `Backup dipulihkan: ${fmt(accounts.length)} kupon, ${fmt(winners.length)} pemenang.`;
      toast("Backup berhasil dipulihkan.");
    } catch (err) {
      toast("Gagal memulihkan backup: " + err.message);
    } finally {
      e.target.value = "";
    }
  });
  $("btnHapusPemenang").addEventListener("click", () => {
    if (
      !confirm(
        "Yakin menghapus daftar pemenang? Semua kupon pemenang akan tersedia kembali.",
      )
    )
      return;
    winners = [];
    accounts.forEach((a) => (a.status = "TERSEDIA"));
    candidate = null;
    currentSpinTicket = null;
    renderWinners();
    $("winnerBanner").classList.add("hidden");
    $("statusImport").textContent = "Daftar pemenang telah dikosongkan.";
    persistState();
  });
  async function enterFullscreen() {
    try {
      if (!document.fullscreenElement) await $("stage").requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {
      document.body.classList.toggle("fullscreen-mode");
    }
  }
  $("btnFullscreen").addEventListener("click", enterFullscreen);
  $("btnKeluarFS").addEventListener("click", async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    document.body.classList.remove("fullscreen-mode");
  });
  document.addEventListener("fullscreenchange", () =>
    document.body.classList.toggle(
      "fullscreen-mode",
      !!document.fullscreenElement,
    ),
  );
  $("btnSound").addEventListener("click", () => {
    soundOn = !soundOn;
    $("btnSound").textContent = soundOn ? "🔊 SUARA AKTIF" : "🔇 SUARA MATI";
    if (!soundOn) stopMusic();
    else if (spinning) startMusic();
    else playEffect("stop");
    toast(soundOn ? "Audio diaktifkan." : "Audio dimatikan.");
  });
  window.addEventListener("beforeunload", () => {
    if (timer) clearInterval(timer);
    stopMusic();
    effectTracks.forEach((a) => {
      a.pause();
    });
  });
  syncPrizeSelects();
  if (!restoreState()) {
    calcTickets();
    renderWinners();
    displayBlank();
    syncButtons();
  } else syncButtons();
})();
