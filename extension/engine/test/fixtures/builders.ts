// Fixture builders for cases plain static HTML can't express: an open
// shadow root and a same-origin iframe both have to be constructed via the
// DOM API (setting `el.shadowRoot`/`iframe.contentDocument` isn't
// expressible as inert markup — a real ATS bundle builds them the same way
// at runtime, which is exactly what survey() has to cope with).

export function mountAshbyFixture(doc: Document): void {
  doc.body.innerHTML = `
    <div id="app">
      <div class="field">
        <input aria-label="First Name" name="applicant_firstname" type="text" required>
      </div>
      <div class="field">
        <input aria-label="Last Name" name="applicant_lastname" type="text" required>
      </div>
      <div class="field">
        <input aria-label="Email" name="applicant_email" type="email" required>
      </div>
      <div class="field">
        <input aria-label="Phone" type="tel" required>
      </div>
      <div id="location-host"></div>
      <fieldset>
        <legend>Are you authorized to work in the US?</legend>
        <label><input type="radio" name="work_auth" value="yes"> Yes</label>
        <label><input type="radio" name="work_auth" value="no"> No</label>
      </fieldset>
      <div class="field">
        <label><input type="checkbox" aria-label="I agree to the terms"> I agree to the terms</label>
      </div>
      <div class="field" role="combobox" aria-label="How did you hear about us?">
        <div class="select__control">Select...</div>
        <ul role="listbox" style="display:none;">
          <li role="option">Referral</li>
          <li role="option">Job Board</li>
          <li role="option">Company Website</li>
        </ul>
      </div>
      <div class="field dropzone" style="position:relative;">
        <div class="dropzone-visual">Drop your resume here</div>
        <input type="file" aria-label="Resume" required
               style="opacity:0;position:absolute;width:1px;height:1px;">
      </div>
      <div class="field">
        <div contenteditable="true" aria-label="Cover Letter"></div>
      </div>
      <button type="submit">Submit Application</button>
    </div>
  `;

  const host = doc.getElementById("location-host")!;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <label for="loc">Location</label>
    <input id="loc" name="location_fuzzy" type="text">
  `;
}

export function mountWorkdayFixture(doc: Document): void {
  doc.body.innerHTML = `
    <div id="app">
      <div class="field">
        <input data-automation-id="legalNameSection_firstName" type="text" aria-label="First Name" required>
      </div>
      <div class="field">
        <input data-automation-id="legalNameSection_lastName" type="text" aria-label="Last Name" required>
      </div>
      <div class="field">
        <input data-automation-id="email" type="email" aria-label="Email Address" required>
      </div>
      <div class="field">
        <input data-automation-id="phone-number" type="tel" aria-label="Phone Number" required>
      </div>
      <div id="address-host"></div>
      <div class="field" role="combobox" aria-label="Country" data-automation-id="countryDropdown">
        <div class="select__control">Type to search...</div>
        <ul role="listbox" style="display:none;">
          <li role="option">United States of America</li>
          <li role="option">Canada</li>
          <li role="option">United Kingdom</li>
        </ul>
      </div>
      <div class="field">
        <input type="file" data-automation-id="file-upload-input" aria-label="Resume" required>
      </div>
      <div class="field">
        <select data-automation-id="source" aria-label="Source">
          <option value="">Select...</option>
          <option value="referral">Referral</option>
          <option value="job_board">Job Board</option>
        </select>
      </div>
      <button data-automation-id="bottom-navigation-next-button" type="button">Next</button>
    </div>
  `;

  // Workday renders the address section behind an open shadow root in
  // production (a wc-based field group); reproduced here the same way.
  const host = doc.getElementById("address-host")!;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <input data-automation-id="addressSection_city" type="text" aria-label="City" required>
    <input data-automation-id="addressSection_postalCode" type="text" aria-label="Postal Code">
  `;
}

export function mountIframeFixture(doc: Document): HTMLIFrameElement {
  const iframe = doc.createElement("iframe");
  doc.body.appendChild(iframe);
  const childDoc = iframe.contentDocument!;
  childDoc.open();
  childDoc.write(`
    <form>
      <div class="field">
        <label for="if_first">First Name</label>
        <input id="if_first" name="job_application[first_name]" type="text" required>
      </div>
      <div class="field">
        <label for="if_email">Email</label>
        <input id="if_email" name="job_application[email]" type="email" required>
      </div>
      <div class="field">
        <label for="if_resume">Resume</label>
        <input id="if_resume" type="file" name="job_application[resume]" required>
      </div>
      <button type="submit">Submit Application</button>
    </form>
  `);
  childDoc.close();
  return iframe;
}
