`timescale 1ns / 1ps

// 同步 FIFO（单时钟）：环形缓冲区 + 读写指针。
//   指针比地址多 1 位：低位相同、最高位不同 => 满；完全相同 => 空。
//   写满时忽略写入，读空时忽略读出；同时读写时 count 不变。
module sync_fifo #(
  parameter WIDTH = 8,
  parameter DEPTH = 8   // 必须是 2 的幂
) (
  input  logic             clk,
  input  logic             rst,
  input  logic             wr_en,
  input  logic [WIDTH-1:0] wr_data,
  input  logic             rd_en,
  output logic [WIDTH-1:0] rd_data,   // 先行（first-word fall-through）输出：始终是队首数据
  output logic             full,
  output logic             empty,
  output logic [$clog2(DEPTH):0] count
);
  localparam AW = $clog2(DEPTH);

  logic [WIDTH-1:0] mem [0:DEPTH-1];
  logic [AW:0]      wr_ptr, rd_ptr;
  logic [AW-1:0]    wr_addr, rd_addr;
  logic             wr_msb, rd_msb;
  logic             do_write, do_read;

  assign wr_addr = wr_ptr[AW-1:0];
  assign rd_addr = rd_ptr[AW-1:0];
  assign wr_msb  = wr_ptr[AW];
  assign rd_msb  = rd_ptr[AW];

  assign full     = (wr_addr == rd_addr) && (wr_msb != rd_msb);
  assign empty    = (wr_ptr == rd_ptr);
  assign count    = wr_ptr - rd_ptr;
  assign do_write = wr_en && !full;
  assign do_read  = rd_en && !empty;
  assign rd_data  = mem[rd_addr];

  always_ff @(posedge clk) begin
    if (do_write) mem[wr_addr] <= wr_data;
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      wr_ptr <= '0;
      rd_ptr <= '0;
    end else begin
      if (do_write) wr_ptr <= wr_ptr + 1'b1;
      if (do_read)  rd_ptr <= rd_ptr + 1'b1;
    end
  end
endmodule
