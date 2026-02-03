document.getElementById("year").textContent = new Date().getFullYear();

const out = document.getElementById("out");
document.getElementById("clickme").addEventListener("click", () => {
  out.textContent = "MinerLife is alive. Next step: add a 3D voxel demo!";
});
