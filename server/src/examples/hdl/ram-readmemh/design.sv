`timescale 1ns / 1ps

// 单端口同步 RAM：用 $readmemh 从 .hex 文件加载初值。
//   同步写、同步读（读出数据晚一拍），这种写法可被 FPGA 综合工具推断为块 RAM（BRAM）。
//   INIT_FILE 为空字符串时不加载初值。
module single_port_ram #(
  parameter ADDR_W    = 4,
  parameter DATA_W    = 8,
  parameter INIT_FILE = "ram_init.hex"
) (
  input  logic              clk,
  input  logic              we,
  input  logic [ADDR_W-1:0] addr,
  input  logic [DATA_W-1:0] din,
  output logic [DATA_W-1:0] dout
);
  logic [DATA_W-1:0] mem [0:(1 << ADDR_W) - 1];

  initial begin
    if (INIT_FILE != "") $readmemh(INIT_FILE, mem);
  end

  always_ff @(posedge clk) begin
    if (we) mem[addr] <= din;
    dout <= mem[addr];   // 读优先（read-first）：同时读写同一地址时读出旧值
  end
endmodule
