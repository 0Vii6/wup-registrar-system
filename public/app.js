// 1. THE 6 DOCUMENTS CATALOG (NO PRICING)
    const DOC_CATALOG = [
      { id: 'cog', name: 'Certificate of Grades (COG)', days: '2-3 Days' },
      { id: 'coe', name: 'Certificate of Enrollment (COE)', days: '1-2 Days' },
      { id: 'tor', name: 'Transcript of Records (TOR)', days: '5-7 Days' },
      { id: 'good_moral', name: 'Good Moral Certificate', days: '2-3 Days' },
      { id: 'completion', name: 'Certificate of Completion', days: '3-4 Days' },
      { id: 'transfer', name: 'Certificate of Transfer', days: '5-7 Days' }
    ];

    // Documents that require the extra Clearance Requirement upload (must mirror server.js CLEARANCE_REQUIRED_DOCS)
    const CLEARANCE_REQUIRED_DOCS = [
      'Transcript of Records (TOR)',
      'Certificate of Transfer',
      'Good Moral Certificate',
      'Certificate of Completion'
    ];

    let currentUser = null;
    let requestsData = [];
    let selectedDocsMap = {};
    let currentStudentFilter = 'all';
    let currentStaffFilter = 'all';
    let currentActiveReviewRef = null;
    let uploadedAssessmentPhotoData = '';
    let uploadedClearancePhotoData = '';
    let showingSetPassword = false;   // true = show "Set a new password" screen instead of the dashboard
    let forcedPasswordChange = false; // true = student is on a mandatory first-login password change (no way out)

    // ---------- API HELPER ----------
    async function apiRequest(method, path, body) {
      const opts = { method, headers: {} };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch('/api' + path, opts);
      let data = null;
      try { data = await res.json(); } catch (e) { /* no body */ }
      if (res.status === 401 && currentUser && path !== '/login') {
        // session expired or was lost on the server -> back to the login screen
        currentUser = null; requestsData = [];
        stopStaffAutoRefresh();
        renderApp();
        throw new Error('Your session expired. Please log in again.');
      }
      if (!res.ok) {
        throw new Error((data && data.error) || `Request failed (${res.status})`);
      }
      return data;
    }

    async function refreshRequestsData() {
      if (!currentUser) { requestsData = []; return; }
      requestsData = currentUser.role === 'student'
        ? await apiRequest('GET', `/requests?studentId=${encodeURIComponent(currentUser.id)}`)
        : await apiRequest('GET', '/requests');
    }

    function applyUpdatedRequest(updated) {
      const idx = requestsData.findIndex(r => r.ref === updated.ref);
      if (idx >= 0) requestsData[idx] = updated;
      else requestsData.unshift(updated);
    }

    window.addEventListener('DOMContentLoaded', async () => {
      renderDocSelectionGrid();
      // Restore the logged-in session (if any) so refreshing the page doesn't kick people to the login screen.
      try {
        currentUser = await apiRequest('GET', '/me');
        await refreshRequestsData();
        if (currentUser.role === 'student' && currentUser.mustChangePassword) {
          openSetPasswordScreen(true);
          return;
        }
      } catch (e) {
        currentUser = null;
      }
      renderApp();
      startStaffAutoRefresh();
    });

    // ---------- registrar: pick up new student requests without a manual refresh ----------
    let staffRefreshTimer = null;
    function startStaffAutoRefresh() {
      stopStaffAutoRefresh();
      if (!currentUser || currentUser.role !== 'staff') return;
      staffRefreshTimer = setInterval(async () => {
        if (document.hidden) return;
        try {
          await refreshRequestsData();
          renderStaffDashboard();
        } catch (e) { /* ignore; a 401 is handled in apiRequest */ }
      }, 15000);
    }
    function stopStaffAutoRefresh() {
      if (staffRefreshTimer) clearInterval(staffRefreshTimer);
      staffRefreshTimer = null;
    }

    // ============================================================
    // AUTH: LOGIN
    // ============================================================
    async function handleUnifiedLogin(e) {
      e.preventDefault();
      const u = document.getElementById('inputUsername').value.trim();
      const p = document.getElementById('inputPassword').value.trim();
      const errBox = document.getElementById('loginError');
      errBox.classList.add('hidden');

      try {
        currentUser = await apiRequest('POST', '/login', { username: u, password: p });
        await refreshRequestsData();

        // Students still on their default (first-login) password are forced to set a real
        // one before they can reach the dashboard — no skipping, no logging out of it.
        if (currentUser.role === 'student' && currentUser.mustChangePassword) {
          openSetPasswordScreen(true);
        } else {
          showingSetPassword = false;
          forcedPasswordChange = false;
          renderApp();
          startStaffAutoRefresh();
        }
      } catch (err) {
        errBox.classList.remove('hidden');
      }
    }

    function togglePasswordVisibility() {
      const field = document.getElementById('inputPassword');
      const icon = document.getElementById('eyeIcon');
      if (field.type === 'password') {
        field.type = 'text';
        icon.className = 'fa-regular fa-eye-slash';
      } else {
        field.type = 'password';
        icon.className = 'fa-regular fa-eye';
      }
    }

    function handleLogout() {
      stopStaffAutoRefresh();
      apiRequest('POST', '/logout').catch(() => {});
      currentUser = null;
      requestsData = [];
      showingSetPassword = false;
      forcedPasswordChange = false;
      document.getElementById('loginForm').reset();
      document.getElementById('loginError').classList.add('hidden');
      closeMobileSidebar();
      renderApp();
    }

    // ============================================================
    // AUTH: FORGOT PASSWORD (SMS not wired up yet — informational only)
    // ============================================================
    function openForgotPasswordInfo() {
      document.getElementById('modalForgotInfo').classList.remove('hidden');
    }
    function closeForgotPasswordInfo() {
      document.getElementById('modalForgotInfo').classList.add('hidden');
    }

    // ============================================================
    // AUTH: SET A NEW PASSWORD (student-only, reached via the sidebar pill)
    // ============================================================
    function handleRolePillClick() {
      if (!currentUser || currentUser.role !== 'student') return; // staff passwords aren't self-service
      openSetPasswordScreen(false);
    }

    // forced=true is used right after login when the student is still on their default
    // password — it hides the Back button so there's no way to skip the change.
    function openSetPasswordScreen(forced) {
      forcedPasswordChange = !!forced;
      showingSetPassword = true;
      document.getElementById('setPasswordForm').reset();
      document.getElementById('setPwError').classList.add('hidden');
      resetPwMeter();
      renderApp();
    }

    function handleAuthBack() {
      if (forcedPasswordChange) return; // no skipping the mandatory first-login change
      showingSetPassword = false;
      renderApp();
    }

    function resetPwMeter() {
      document.querySelectorAll('#pwMeterBar .pw-meter-segment').forEach(seg => {
        seg.className = 'pw-meter-segment';
      });
    }

    function updatePwMeter() {
      const val = document.getElementById('pwNew').value;
      let score = 0;
      if (val.length >= 8) score++;
      if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
      if (/[0-9]/.test(val)) score++;
      if (/[^A-Za-z0-9]/.test(val)) score++;

      const cls = score <= 1 ? 'filled-weak' : score === 2 ? 'filled-weak' : score === 3 ? 'filled-mid' : 'filled-strong';
      const segs = document.querySelectorAll('#pwMeterBar .pw-meter-segment');
      segs.forEach((seg, i) => {
        seg.className = i < score ? `pw-meter-segment ${cls}` : 'pw-meter-segment';
      });
    }

    async function handleSetPasswordSubmit(e) {
      e.preventDefault();
      const errBox = document.getElementById('setPwError');
      errBox.classList.add('hidden');

      const currentPassword = document.getElementById('pwCurrent').value;
      const newPassword = document.getElementById('pwNew').value;
      const confirmPassword = document.getElementById('pwConfirm').value;

      if (newPassword.length < 8) {
        errBox.innerText = 'New password must be at least 8 characters.';
        errBox.classList.remove('hidden');
        return;
      }
      if (newPassword !== confirmPassword) {
        errBox.innerText = 'New password and confirmation do not match.';
        errBox.classList.remove('hidden');
        return;
      }

      try {
        await apiRequest('POST', '/change-password', {
          id: currentUser.id,
          role: currentUser.role,
          currentPassword,
          newPassword
        });
        document.getElementById('modalPwUpdated').classList.remove('hidden');
      } catch (err) {
        errBox.innerText = err.message || 'Could not update password.';
        errBox.classList.remove('hidden');
      }
    }

    function closePwUpdatedModal() {
      document.getElementById('modalPwUpdated').classList.add('hidden');
      showingSetPassword = false;
      forcedPasswordChange = false;
      if (currentUser) currentUser.mustChangePassword = false;
      renderApp();
    }

    // ============================================================
    // ROOT RENDER — decides which shell/screen to show
    // ============================================================
    function renderApp() {
      const authShell = document.getElementById('authShell');
      const appShell = document.getElementById('appShell');
      const vLogin = document.getElementById('viewLogin');
      const vSetPassword = document.getElementById('viewSetPassword');
      const authBackBtn = document.getElementById('authBackBtn');

      if (!currentUser) {
        authShell.classList.remove('hidden');
        appShell.classList.add('hidden');
        vLogin.classList.remove('hidden');
        vSetPassword.classList.add('hidden');
        authBackBtn.classList.add('hidden');
        return;
      }

      if (showingSetPassword) {
        authShell.classList.remove('hidden');
        appShell.classList.add('hidden');
        vLogin.classList.add('hidden');
        vSetPassword.classList.remove('hidden');

        const eyebrow = document.getElementById('setPwEyebrow');
        if (forcedPasswordChange) {
          authBackBtn.classList.add('hidden');
          authBackBtn.classList.remove('flex');
          eyebrow.innerText = "Required · You're still using your default password";
        } else {
          authBackBtn.classList.remove('hidden');
          authBackBtn.classList.add('flex');
          eyebrow.innerText = 'Account Security · Password';
        }
        return;
      }

      authShell.classList.add('hidden');
      appShell.classList.remove('hidden');

      const vStudent = document.getElementById('viewStudent');
      const vStaff = document.getElementById('viewStaff');
      const roleBottomPill = document.getElementById('roleBottomPill');
      const roleBottomPillLabel = document.getElementById('roleBottomPillLabel');

      if (currentUser.role === 'student') {
        vStudent.classList.remove('hidden');
        vStaff.classList.add('hidden');
        document.getElementById('dispStudentId').innerText = currentUser.id;
        document.getElementById('dispStudentName').innerText = currentUser.name;
        document.getElementById('dispStudentCourse').innerText = currentUser.course;

        roleBottomPillLabel.innerText = 'Student';
        roleBottomPill.classList.remove('opacity-60', 'cursor-default');
        roleBottomPill.classList.add('cursor-pointer');

        renderSidebarNav('student');
        renderStudentDashboard();
      } else {
        vStudent.classList.add('hidden');
        vStaff.classList.remove('hidden');

        roleBottomPillLabel.innerText = 'Staff';
        // Staff can't self-service change their password from here (student-only feature)
        roleBottomPill.classList.add('opacity-60', 'cursor-default');
        roleBottomPill.classList.remove('cursor-pointer');

        renderSidebarNav('staff');
        renderStaffDashboard();
      }
    }

    // ============================================================
    // SIDEBAR NAVIGATION
    // ============================================================
    // ============================================================
    // MOBILE SIDEBAR DRAWER (phone layout, below the 451px 'dt' breakpoint)
    // ============================================================
    function openMobileSidebar() {
      document.getElementById('sidebarAside').classList.add('mobile-open');
      document.getElementById('sidebarBackdrop').classList.remove('hidden');
    }
    function closeMobileSidebar() {
      document.getElementById('sidebarAside').classList.remove('mobile-open');
      document.getElementById('sidebarBackdrop').classList.add('hidden');
    }

    function renderSidebarNav(role) {
      const nav = document.getElementById('sidebarNav');
      if (role === 'student') {
        const items = [
          { key: 'all', label: 'All', icon: 'fa-solid fa-box-archive' },
          { key: 'pending', label: 'Pending', icon: 'fa-solid fa-hourglass-half' },
          { key: 'processing', label: 'Processing', icon: 'fa-solid fa-print' },
          { key: 'ready', label: 'Ready to Claim', icon: 'fa-solid fa-square-check' },
          { key: 'claimed', label: 'Claimed', icon: 'fa-solid fa-box' }
        ];
        nav.innerHTML = items.map(it => `
          <button onclick="switchStudentTab('${it.key}')" class="side-nav-item ${currentStudentFilter === it.key ? 'active' : ''}">
            <i class="${it.icon} w-4"></i> ${it.label}
          </button>
        `).join('');
      } else {
        const items = [
          { key: 'all', label: 'All', icon: 'fa-solid fa-box-archive' },
          { key: 'pending', label: 'Pending', icon: 'fa-solid fa-hourglass-half' },
          { key: 'processing', label: 'Processing', icon: 'fa-solid fa-print' },
          { key: 'ready', label: 'Ready to Claim', icon: 'fa-solid fa-square-check' },
          { key: 'claimed', label: 'Claimed', icon: 'fa-solid fa-box' },
          { key: 'rejected', label: 'Rejected', icon: 'fa-solid fa-file-circle-xmark' }
        ];
        nav.innerHTML = items.map(it => `
          <button onclick="setStaffFilter('${it.key}')" class="side-nav-item ${currentStaffFilter === it.key ? 'active' : ''}">
            <i class="${it.icon} w-4"></i> ${it.label}
          </button>
        `).join('');
      }
    }

    // ============================================================
    // STUDENT PORTAL
    // ============================================================
    function renderDocSelectionGrid() {
      const container = document.getElementById('docSelectionList');
      container.innerHTML = DOC_CATALOG.map(doc => `
        <div class="p-3 border border-slate-200 rounded-xl hover:border-gold transition bg-white flex flex-col justify-between">
          <div>
            <span class="font-bold text-xs text-slate-800 leading-tight block">${doc.name}</span>
            <p class="text-[10px] text-slate-500 mt-1"><i class="fa-solid fa-stopwatch mr-1"></i>${doc.days}</p>
          </div>
          <div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
            <span class="text-[11px] text-slate-400 font-medium">Quantity:</span>
            <div class="flex items-center gap-2">
              <button type="button" onclick="adjustDocQuantity('${doc.id}', -1)" class="w-6 h-6 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold">-</button>
              <span id="qty-${doc.id}" class="text-xs font-bold text-slate-800 w-4 text-center">0</span>
              <button type="button" onclick="adjustDocQuantity('${doc.id}', 1)" class="w-6 h-6 rounded bg-amber-100 text-amber-900 hover:bg-amber-200 text-xs font-bold">+</button>
            </div>
          </div>
        </div>
      `).join('');
    }

    function adjustDocQuantity(id, delta) {
      const current = selectedDocsMap[id] || 0;
      const next = Math.max(0, current + delta);
      selectedDocsMap[id] = next;
      document.getElementById(`qty-${id}`).innerText = next;
      updateClearanceVisibility();
    }

    // Shows/hides the Clearance Requirement upload block based on whether any currently
    // selected document requires it. If it becomes hidden, clear whatever was uploaded so
    // a stale file doesn't silently get submitted if they change their selection back and forth.
    function updateClearanceVisibility() {
      const needsClearance = DOC_CATALOG.some(doc =>
        (selectedDocsMap[doc.id] || 0) > 0 && CLEARANCE_REQUIRED_DOCS.includes(doc.name)
      );
      const section = document.getElementById('clearanceUploadSection');
      if (needsClearance) {
        section.classList.remove('hidden');
      } else {
        section.classList.add('hidden');
        uploadedClearancePhotoData = '';
        document.getElementById('fileClearance').value = '';
        document.getElementById('fileClearanceLabel').innerText = 'Click to upload Clearance Requirement (JPG, PNG, PDF)';
        document.getElementById('clearancePhotoPreviewContainer').classList.add('hidden');
        document.getElementById('clearanceUploadIcon').classList.remove('hidden');
      }
    }

    function handleAssessmentFileSelected(input) {
      if (input.files && input.files[0]) {
        const file = input.files[0];
        document.getElementById('fileAssessmentLabel').innerText = `Attached: ${file.name}`;

        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            uploadedAssessmentPhotoData = e.target.result;
            document.getElementById('assessmentPhotoPreview').src = uploadedAssessmentPhotoData;
            document.getElementById('assessmentPhotoPreviewContainer').classList.remove('hidden');
            document.getElementById('assessmentUploadIcon').classList.add('hidden');
          };
          reader.readAsDataURL(file);
        } else {
          // PDF or other — still capture as a data URI so it's stored, just no image preview
          const reader = new FileReader();
          reader.onload = (e) => { uploadedAssessmentPhotoData = e.target.result; };
          reader.readAsDataURL(file);
          document.getElementById('assessmentPhotoPreviewContainer').classList.add('hidden');
          document.getElementById('assessmentUploadIcon').classList.remove('hidden');
        }
      }
    }

    function handleClearanceFileSelected(input) {
      if (input.files && input.files[0]) {
        const file = input.files[0];
        document.getElementById('fileClearanceLabel').innerText = `Attached: ${file.name}`;

        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            uploadedClearancePhotoData = e.target.result;
            document.getElementById('clearancePhotoPreview').src = uploadedClearancePhotoData;
            document.getElementById('clearancePhotoPreviewContainer').classList.remove('hidden');
            document.getElementById('clearanceUploadIcon').classList.add('hidden');
          };
          reader.readAsDataURL(file);
        } else {
          const reader = new FileReader();
          reader.onload = (e) => { uploadedClearancePhotoData = e.target.result; };
          reader.readAsDataURL(file);
          document.getElementById('clearancePhotoPreviewContainer').classList.add('hidden');
          document.getElementById('clearanceUploadIcon').classList.remove('hidden');
        }
      }
    }

    function openNewRequestModal() {
      selectedDocsMap = {};
      DOC_CATALOG.forEach(doc => {
        const el = document.getElementById(`qty-${doc.id}`);
        if (el) el.innerText = '0';
      });
      document.getElementById('reqOrNumber').value = '';
      document.getElementById('fileAssessment').value = '';
      document.getElementById('fileAssessmentLabel').innerText = 'Click to upload Assessment Form (JPG, PNG, PDF)';
      document.getElementById('assessmentPhotoPreviewContainer').classList.add('hidden');
      document.getElementById('assessmentUploadIcon').classList.remove('hidden');
      uploadedAssessmentPhotoData = '';
      updateClearanceVisibility(); // nothing selected yet, so this hides & resets the clearance block
      document.getElementById('modalNewRequest').classList.remove('hidden');
    }

    function closeNewRequestModal() {
      document.getElementById('modalNewRequest').classList.add('hidden');
    }

    async function submitNewRequest() {
      const items = DOC_CATALOG
        .filter(doc => (selectedDocsMap[doc.id] || 0) > 0)
        .map(doc => ({ name: doc.name, copies: selectedDocsMap[doc.id] }));

      const orNumber = document.getElementById('reqOrNumber').value.trim();
      const needsClearance = items.some(it => CLEARANCE_REQUIRED_DOCS.includes(it.name));

      if (items.length === 0) { alert('Please select at least one document.'); return; }
      if (!orNumber) { alert('Please enter the Cashier Official Receipt (OR) Number.'); return; }
      if (!uploadedAssessmentPhotoData) { alert('Please upload your Assessment Form.'); return; }
      if (needsClearance && !uploadedClearancePhotoData) { alert('Please upload your Clearance Requirement for the selected document(s).'); return; }

      try {
        const created = await apiRequest('POST', '/requests', {
          studentId: currentUser.id,
          items,
          orNumber,
          assessmentPhoto: uploadedAssessmentPhotoData,
          clearancePhoto: uploadedClearancePhotoData
        });
        applyUpdatedRequest(created);
        closeNewRequestModal();
        document.getElementById('submittedRefDisplay').innerText = `Tracking Reference: ${created.ref}`;
        document.getElementById('modalRequestSubmitted').classList.remove('hidden');
        currentStudentFilter = 'all';
        renderSidebarNav('student');
        renderStudentDashboard();
      } catch (err) {
        alert('Could not submit request: ' + err.message);
      }
    }

    function closeRequestSubmittedModal() {
      document.getElementById('modalRequestSubmitted').classList.add('hidden');
    }

    function switchStudentTab(tab) {
      currentStudentFilter = tab;
      renderSidebarNav('student');
      renderStudentDashboard();
      closeMobileSidebar();
    }

    function renderStudentDashboard() {
      const container = document.getElementById('studentRequestsContainer');
      let list = requestsData;
      if (currentStudentFilter === 'pending') {
        list = list.filter(r => r.status === 'pending_verification');
      } else if (currentStudentFilter === 'processing') {
        list = list.filter(r => r.status === 'processing');
      } else if (currentStudentFilter === 'ready') {
        list = list.filter(r => r.status === 'ready');
      } else if (currentStudentFilter === 'claimed') {
        list = list.filter(r => r.status === 'completed');
      }

      if (list.length === 0) {
        container.innerHTML = `
          <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-400 text-sm">
            <i class="fa-solid fa-inbox text-2xl mb-2 block"></i>
            No requests to show here yet.
          </div>
        `;
        return;
      }

      container.innerHTML = list.map(req => {
        const itemsLabel = req.items.map(i => `${i.copies}x${i.name}`).join(', ');
        // "Request Filed" is done as soon as it's submitted. "In-Processing" only lights up
        // once the registrar has verified it and processing has actually begun (matches the
        // separate Pending / In-Processing / Claim sidebar tabs). Rejected requests stop at "Request Filed".
        const stepDone = { filed: true, processing: false, ready: false };
        if (['processing', 'ready', 'completed'].includes(req.status)) stepDone.processing = true;
        if (['ready', 'completed'].includes(req.status)) stepDone.ready = true;

        return `
        <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
            <div class="flex items-center gap-3">
              <span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 font-mono">Ref: ${req.ref}</span>
              <span class="text-xs text-slate-400">Requested on ${req.dateSubmitted}</span>
            </div>
            ${getStatusBadge(req.status)}
          </div>

          <div class="px-5 py-4 grid grid-cols-1 dt:grid-cols-3 gap-4">
            <div>
              <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Documents Requested</div>
              <div class="text-sm font-semibold text-slate-800">${itemsLabel}</div>
            </div>
            <div>
              <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Payment &amp; Assessment Form</div>
              <div class="text-sm font-mono font-bold text-slate-800">OR # ${req.orNumber}</div>
              <div class="text-[11px] text-slate-500 mt-0.5"><i class="fa-solid fa-paperclip mr-1"></i>Assessment Form Attached</div>
            </div>
            <div>
              <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Status</div>
              <div class="text-xs text-slate-600">${req.timeline[req.timeline.length - 1]?.title || ''}</div>
              ${req.status === 'rejected' ? `<div class="text-xs text-red-600 font-semibold mt-1">${req.rejectionReason}</div>` : ''}
            </div>
          </div>

          <div class="px-5 pb-4">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Progress Tracker</div>
            <div class="flex gap-2">
              <div class="progress-step ${stepDone.filed ? 'done' : ''}">Request Filed</div>
              <div class="progress-step ${stepDone.processing ? 'done' : ''}">Processing</div>
              <div class="progress-step ${stepDone.ready ? 'done' : ''}">Ready to Claim</div>
            </div>
          </div>
        </div>
      `;
      }).join('');
    }

    // ============================================================
    // STAFF PORTAL
    // ============================================================
    function setStaffFilter(filter) {
      currentStaffFilter = filter;
      renderSidebarNav('staff');
      renderStaffDashboard();
      closeMobileSidebar();
    }

    function filterStaffQueue() {
      renderStaffDashboard();
    }

    function renderStaffDashboard() {
      const pending = requestsData.filter(r => r.status === 'pending_verification').length;
      const processing = requestsData.filter(r => r.status === 'processing').length;
      const ready = requestsData.filter(r => r.status === 'ready').length;
      const rejected = requestsData.filter(r => r.status === 'rejected').length;

      document.getElementById('metricPending').innerText = pending;
      document.getElementById('metricProcessing').innerText = processing;
      document.getElementById('metricReady').innerText = ready;
      document.getElementById('metricRejected').innerText = rejected;

      let list = requestsData;
      if (currentStaffFilter === 'pending') list = list.filter(r => r.status === 'pending_verification');
      else if (currentStaffFilter === 'processing') list = list.filter(r => r.status === 'processing');
      else if (currentStaffFilter === 'ready') list = list.filter(r => r.status === 'ready');
      else if (currentStaffFilter === 'claimed') list = list.filter(r => r.status === 'completed');
      else if (currentStaffFilter === 'rejected') list = list.filter(r => r.status === 'rejected');

      const search = (document.getElementById('staffSearchInput').value || '').trim().toLowerCase();
      if (search) {
        list = list.filter(r =>
          r.studentId.toLowerCase().includes(search) ||
          r.studentName.toLowerCase().includes(search) ||
          r.ref.toLowerCase().includes(search)
        );
      }

      const tbody = document.getElementById('staffTableBody');
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-10 text-center text-slate-400 text-sm">No requests match this view.</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map(req => `
        <tr class="hover:bg-slate-50">
          <td class="px-4 py-3.5 whitespace-nowrap">
            <div class="font-bold text-slate-800 font-mono text-xs">${req.ref}</div>
            <div class="text-[11px] text-slate-400">${req.dateSubmitted}</div>
          </td>
          <td class="px-4 p y-3.5">
            <div class="font-semibold text-slate-800">${req.studentName}</div>
            <div class="text-[11px] text-slate-400 font-mono">${req.studentId}</div>
          </td>
          <td class="px-4 py-3.5 text-xs text-slate-600 w-[400px] max-w-[200px] break-words">${req.items.map(i => `${i.copies}x${i.name}`).join(', ')}</td>
          <td class="px-4 py-3.5 text-xs text-authv font-semibold whitespace-nowrap"><i class="fa-solid fa-paperclip mr-1"></i>Attached</td>
          <td class="px-4 py-3.5 text-xs font-mono whitespace-nowrap">${req.orNumber}</td>
          <td class="px-4 py-3.5 whitespace-nowrap min-w-[150px]">${getStatusBadge(req.status)}</td>
          <td class="px-4 py-3.5 text-right">
            <button onclick="openStaffReviewModal('${req.ref}')" class="px-3 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full whitespace-nowrap">
              <i class="fa-solid fa-magnifying-glass mr-1"></i> Inspect
            </button>
          </td>
        </tr>
      `).join('');
    }

    function openStaffReviewModal(ref) {
      const req = requestsData.find(r => r.ref === ref);
      if (!req) return;
      currentActiveReviewRef = ref;

      document.getElementById('revModalHeader').innerText = `Review Application — ${req.ref}`;
      document.getElementById('revStudentName').innerText = req.studentName;
      document.getElementById('revStudentId').innerText = req.studentId;
      document.getElementById('revTrackingRef').innerText = req.ref;
      document.getElementById('revDate').innerText = req.dateSubmitted;
      document.getElementById('revOrNumber').innerText = req.orNumber;

      const orBadge = document.getElementById('revOrBadge');
      if (req.status === 'pending_verification') {
        orBadge.innerText = 'Awaiting Verification';
        orBadge.className = 'text-[11px] px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-800';
      } else if (req.status === 'rejected') {
        orBadge.innerText = 'Rejected';
        orBadge.className = 'text-[11px] px-2 py-0.5 rounded font-bold bg-red-100 text-red-800';
      } else {
        orBadge.innerText = 'Verified';
        orBadge.className = 'text-[11px] px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-800';
      }

      document.getElementById('revAssessmentContainer').innerHTML = req.assessmentPhoto && req.assessmentPhoto.startsWith('data:image')
        ? `
          <img src="${req.assessmentPhoto}" onclick="openAssessmentFullPreview('${req.ref}')"
            class="max-h-52 mx-auto rounded-lg border border-slate-200 cursor-zoom-in hover:opacity-90 transition" />
          <button type="button" onclick="openAssessmentFullPreview('${req.ref}')"
            class="mt-2 w-full text-center text-[11px] font-semibold text-authv hover:text-authv-hover">
            <i class="fa-solid fa-up-right-and-down-left-from-center mr-1"></i> Click preview to open full-size
          </button>
        `
        : req.assessmentPhoto
          ? `
            <button type="button" onclick="openAssessmentFullPreview('${req.ref}')" class="text-xs text-authv font-semibold hover:text-authv-hover">
              <i class="fa-solid fa-file-lines mr-1"></i> ${req.assessmentPhoto} — click to open
            </button>
          `
          : `<div class="text-xs text-slate-500"><i class="fa-solid fa-file-circle-xmark mr-1"></i>No file attached</div>`;

      // Clearance Requirement box only shows up when this request actually has one attached.
      const clearanceBox = document.getElementById('revClearanceBox');
      if (req.clearancePhoto) {
        clearanceBox.classList.remove('hidden');
        document.getElementById('revClearanceContainer').innerHTML = req.clearancePhoto.startsWith('data:image')
          ? `
            <img src="${req.clearancePhoto}" onclick="openClearanceFullPreview('${req.ref}')"
              class="max-h-52 mx-auto rounded-lg border border-slate-200 cursor-zoom-in hover:opacity-90 transition" />
            <button type="button" onclick="openClearanceFullPreview('${req.ref}')"
              class="mt-2 w-full text-center text-[11px] font-semibold text-authv hover:text-authv-hover">
              <i class="fa-solid fa-up-right-and-down-left-from-center mr-1"></i> Click preview to open full-size
            </button>
          `
          : `
            <button type="button" onclick="openClearanceFullPreview('${req.ref}')" class="text-xs text-authv font-semibold hover:text-authv-hover">
              <i class="fa-solid fa-file-lines mr-1"></i> ${req.clearancePhoto} — click to open
            </button>
          `;
      } else {
        clearanceBox.classList.add('hidden');
        document.getElementById('revClearanceContainer').innerHTML = '';
      }

      document.getElementById('revDocsList').innerHTML = req.items.map(item => `
        <div class="flex justify-between p-2 bg-slate-50 rounded border border-slate-200 text-xs">
          <span class="font-semibold text-slate-800">${item.copies}x ${item.name}</span>
        </div>
      `).join('');

      const rejectBox = document.getElementById('revRejectReasonBox');
      if (req.status === 'rejected') {
        rejectBox.classList.remove('hidden');
        document.getElementById('revRejectReasonText').innerText = req.rejectionReason;
      } else {
        rejectBox.classList.add('hidden');
      }

      // Reject is only a valid action before verification begins — once it's in-processing,
      // ready, already rejected, or completed, the reject button no longer applies.
      const rejectBtn = document.getElementById('revRejectBtn');
      if (req.status === 'pending_verification') {
        rejectBtn.classList.remove('hidden');
      } else {
        rejectBtn.classList.add('hidden');
      }

      const actionsContainer = document.getElementById('revActionButtons');
      if (req.status === 'pending_verification') {
        actionsContainer.innerHTML = `
          <button onclick="staffApprovePayment('${req.ref}')" class="px-4 py-2 bg-olive hover:bg-olive-dark text-white font-bold text-xs rounded-full shadow">
            <i class="fa-solid fa-check mr-1"></i> Verify Documents &amp; Begin Processing
          </button>
        `;
      } else if (req.status === 'processing') {
        actionsContainer.innerHTML = `
          <button onclick="staffMarkReady('${req.ref}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-full shadow">
            <i class="fa-solid fa-box-archive mr-1"></i> Mark as Ready to Claim
          </button>
        `;
      } else if (req.status === 'ready') {
        actionsContainer.innerHTML = `
          <button onclick="staffMarkCompleted('${req.ref}')" class="px-4 py-2 bg-olive hover:bg-olive-dark text-white font-bold text-xs rounded-full shadow">
            <i class="fa-solid fa-check-double mr-1"></i> Mark as Claimed / Completed
          </button>
        `;
      } else {
        actionsContainer.innerHTML = `<span class="text-xs font-semibold text-slate-400">Request Closed</span>`;
      }

      document.getElementById('modalStaffReview').classList.remove('hidden');
    }

    function closeStaffReviewModal() {
      document.getElementById('modalStaffReview').classList.add('hidden');
    }

    function openAssessmentFullPreview(ref) {
      const req = requestsData.find(r => r.ref === ref);
      if (!req || !req.assessmentPhoto) return;
      // Data URIs (image or PDF) open cleanly in a new tab at full size/native viewer.
      const win = window.open();
      if (req.assessmentPhoto.startsWith('data:image')) {
        win.document.write(`<title>Assessment Form — ${req.ref}</title><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${req.assessmentPhoto}" style="max-width:100%;max-height:100vh;"/></body>`);
      } else if (req.assessmentPhoto.startsWith('data:')) {
        win.location.href = req.assessmentPhoto;
      } else {
        win.document.write(`<title>Assessment Form — ${req.ref}</title><body style="font-family:sans-serif;padding:2rem;">No previewable file was attached for this request (${req.assessmentPhoto}).</body>`);
      }
    }

    function openClearanceFullPreview(ref) {
      const req = requestsData.find(r => r.ref === ref);
      if (!req || !req.clearancePhoto) return;
      const win = window.open();
      if (req.clearancePhoto.startsWith('data:image')) {
        win.document.write(`<title>Clearance Requirement — ${req.ref}</title><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${req.clearancePhoto}" style="max-width:100%;max-height:100vh;"/></body>`);
      } else if (req.clearancePhoto.startsWith('data:')) {
        win.location.href = req.clearancePhoto;
      } else {
        win.document.write(`<title>Clearance Requirement — ${req.ref}</title><body style="font-family:sans-serif;padding:2rem;">No previewable file was attached for this request (${req.clearancePhoto}).</body>`);
      }
    }

    async function staffApprovePayment(ref) {
      try {
        const updated = await apiRequest('POST', `/requests/${encodeURIComponent(ref)}/approve-payment`);
        applyUpdatedRequest(updated);
      } catch (err) {
        alert('Action failed: ' + err.message);
      }
      closeStaffReviewModal();
      renderStaffDashboard();
    }

    async function staffMarkReady(ref) {
      try {
        const updated = await apiRequest('POST', `/requests/${encodeURIComponent(ref)}/mark-ready`);
        applyUpdatedRequest(updated);
      } catch (err) {
        alert('Action failed: ' + err.message);
      }
      closeStaffReviewModal();
      renderStaffDashboard();
    }

    async function staffMarkCompleted(ref) {
      try {
        const updated = await apiRequest('POST', `/requests/${encodeURIComponent(ref)}/mark-completed`);
        applyUpdatedRequest(updated);
      } catch (err) {
        alert('Action failed: ' + err.message);
      }
      closeStaffReviewModal();
      renderStaffDashboard();
    }

    function promptRejectModal() {
      document.getElementById('rejectPreset').value = '';
      document.getElementById('rejectCustomText').value = '';
      document.getElementById('modalRejectReason').classList.remove('hidden');
    }

    function closeRejectPrompt() {
      document.getElementById('modalRejectReason').classList.add('hidden');
    }

    function applyRejectPreset(val) {
      if (val) document.getElementById('rejectCustomText').value = val;
    }

    async function confirmReject() {
      const reason = document.getElementById('rejectCustomText').value.trim();
      if (!reason) {
        alert('Please specify a rejection reason.');
        return;
      }
      try {
        const updated = await apiRequest('POST', `/requests/${encodeURIComponent(currentActiveReviewRef)}/reject`, { reason });
        applyUpdatedRequest(updated);
      } catch (err) {
        alert('Action failed: ' + err.message);
      }
      closeRejectPrompt();
      closeStaffReviewModal();
      renderStaffDashboard();
    }

    function getStatusBadge(st) {
      switch (st) {
        case 'pending_verification':
          return '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 badge-pulse"><i class="fa-solid fa-magnifying-glass mr-1"></i>Pending Review</span>';
        case 'processing':
          return '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200"><i class="fa-solid fa-print mr-1"></i>Processing</span>';
        case 'ready':
          return '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 badge-pulse"><i class="fa-solid fa-circle-check mr-1"></i>Ready to Claim</span>';
        case 'completed':
          return '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200"><i class="fa-solid fa-box mr-1"></i>Claimed</span>';
        case 'rejected':
          return '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200"><i class="fa-solid fa-circle-xmark mr-1"></i>Rejected</span>';
        default:
          return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">${st}</span>`;
      }
    }
