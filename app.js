const button = document.getElementById("count");
const label = button.querySelector("span");
let count = 0;
button.addEventListener("click", () => {
  count += 1;
  label.textContent = String(count);
});
